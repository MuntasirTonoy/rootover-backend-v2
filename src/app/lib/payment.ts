// The only place that takes money. Two providers behind one interface:
// - bkash: bKash Tokenized Checkout (sandbox or live, from BKASH_BASE_URL).
//   create -> the payer approves on bKash's page -> bKash redirects the browser
//   to our callback -> execute confirms it server to server.
// - simulated: nothing is charged; the "payment page" is our own callback with
//   status=success, and execute always succeeds. For tests and local dev only
//   (config refuses it in production).
import { randomInt } from "node:crypto";
import httpStatus from "http-status";
import config from "../../config/index.js";
import AppError from "../errors/AppError.js";

export interface CreatePaymentInput {
	amount: number;
	// Our Payment id, shown to the payer and in bKash's merchant panel
	invoice: string;
	payerReference: string;
	callbackURL: string;
}

export interface CreatedPayment {
	providerPaymentId: string;
	// Where to send the payer's browser
	redirectURL: string;
}

export type PaymentOutcome =
	| { status: "completed"; trxId: string; payerNumber?: string }
	| { status: "failed"; reason: string };

export interface PaymentProvider {
	name: "bkash" | "simulated";
	// Shown in activity-log entries, e.g. "Purchased a course (bKash sandbox)"
	label: string;
	createPayment: (input: CreatePaymentInput) => Promise<CreatedPayment>;
	executePayment: (providerPaymentId: string) => Promise<PaymentOutcome>;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// DEMO + base36 timestamp + 3 random characters, uppercase (spec section 7)
export const generateTrxId = (prefix = "DEMO") =>
	`${prefix}${Date.now().toString(36).toUpperCase()}${Array.from(
		{ length: 3 },
		() => ALPHABET[randomInt(ALPHABET.length)],
	).join("")}`;

// ---------------------------------------------------------------- simulated

const simulated: PaymentProvider = {
	name: "simulated",
	label: "simulated payment",
	createPayment: async ({ callbackURL }) => {
		const providerPaymentId = generateTrxId("SIM");
		const url = new URL(callbackURL);
		url.searchParams.set("paymentID", providerPaymentId);
		url.searchParams.set("status", "success");
		return { providerPaymentId, redirectURL: url.toString() };
	},
	// An obviously fictional wallet number
	executePayment: async () => ({
		status: "completed",
		trxId: generateTrxId(),
		payerNumber: "01000000000",
	}),
};

// ---------------------------------------------------------------- bKash

const bkashConfig = config.payment.bkash;
const GATEWAY_ERROR =
	"The payment gateway is not responding. Please try again.";

interface BkashResponse {
	statusCode?: string;
	statusMessage?: string;
	errorCode?: string;
	errorMessage?: string;
	[key: string]: unknown;
}

const bkashError = (body: BkashResponse) =>
	body.statusCode && body.statusCode !== "0000"
		? `${body.statusMessage ?? "Payment error"} (${body.statusCode})`
		: body.errorCode
			? `${body.errorMessage ?? "Payment error"} (${body.errorCode})`
			: null;

const bkashFetch = async (
	path: string,
	body: unknown,
	headers: Record<string, string>,
): Promise<BkashResponse> => {
	let res: Response;
	try {
		res = await fetch(`${bkashConfig.base_url}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				...headers,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
		});
	} catch {
		throw new AppError(httpStatus.BAD_GATEWAY, GATEWAY_ERROR);
	}
	const text = await res.text();
	try {
		return text ? (JSON.parse(text) as BkashResponse) : {};
	} catch {
		throw new AppError(httpStatus.BAD_GATEWAY, GATEWAY_ERROR);
	}
};

// id_token lasts an hour; a fresh one is granted a few minutes before that
let token: { value: string; expiresAt: number } | null = null;

const grantToken = async () => {
	if (token && token.expiresAt > Date.now()) return token.value;
	const body = await bkashFetch(
		"/tokenized/checkout/token/grant",
		{ app_key: bkashConfig.app_key, app_secret: bkashConfig.app_secret },
		{ username: bkashConfig.username, password: bkashConfig.password },
	);
	const error = bkashError(body);
	if (error || typeof body.id_token !== "string") {
		console.error(`[bkash] token grant failed: ${error ?? "no id_token"}`);
		throw new AppError(httpStatus.BAD_GATEWAY, GATEWAY_ERROR);
	}
	const lifetime = Number(body.expires_in) || 3600;
	token = {
		value: body.id_token,
		expiresAt: Date.now() + (lifetime - 300) * 1000,
	};
	return token.value;
};

const authorized = async (path: string, body: unknown) =>
	bkashFetch(path, body, {
		Authorization: await grantToken(),
		"X-App-Key": bkashConfig.app_key,
	});

const completedOutcome = (body: BkashResponse): PaymentOutcome | null =>
	body.transactionStatus === "Completed" && typeof body.trxID === "string"
		? {
				status: "completed",
				trxId: body.trxID,
				payerNumber:
					typeof body.customerMsisdn === "string"
						? body.customerMsisdn
						: undefined,
			}
		: null;

const bkash: PaymentProvider = {
	name: "bkash",
	label: bkashConfig.sandbox ? "bKash sandbox" : "bKash",
	createPayment: async (input) => {
		const body = await authorized("/tokenized/checkout/create", {
			mode: "0011",
			payerReference: input.payerReference,
			callbackURL: input.callbackURL,
			amount: input.amount.toFixed(2),
			currency: "BDT",
			intent: "sale",
			merchantInvoiceNumber: input.invoice,
		});
		const error = bkashError(body);
		if (
			error ||
			typeof body.paymentID !== "string" ||
			typeof body.bkashURL !== "string"
		) {
			console.error(`[bkash] create failed: ${error ?? "no paymentID"}`);
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"bKash couldn't start the payment. Please try again.",
			);
		}
		return { providerPaymentId: body.paymentID, redirectURL: body.bkashURL };
	},
	// Execute, and if that doesn't report Completed (e.g. a repeated callback or
	// a timeout), ask bKash for the payment's actual status
	executePayment: async (paymentID) => {
		const executed = await authorized("/tokenized/checkout/execute", {
			paymentID,
		}).catch(() => ({}) as BkashResponse);
		const done = completedOutcome(executed);
		if (done) return done;
		const status = await authorized("/tokenized/checkout/payment/status", {
			paymentID,
		});
		return (
			completedOutcome(status) ?? {
				status: "failed",
				reason:
					bkashError(executed) ??
					bkashError(status) ??
					`Payment ${String(status.transactionStatus ?? "not completed").toLowerCase()}.`,
			}
		);
	},
};

export const paymentProvider: PaymentProvider =
	config.payment.provider === "bkash" ? bkash : simulated;
