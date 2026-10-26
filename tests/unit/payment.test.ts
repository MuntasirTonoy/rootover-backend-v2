// The bKash provider against a mocked Tokenized Checkout API: request shapes,
// token reuse, and the execute -> payment/status fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";

type Call = { path: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let replies: Record<string, unknown[]> = {};

const reply = (path: string, ...bodies: unknown[]) => {
	replies[path] = [...(replies[path] ?? []), ...bodies];
};

const loadProvider = async () => {
	vi.resetModules();
	for (const [k, v] of Object.entries({
		PAYMENT_PROVIDER: "bkash",
		BKASH_BASE_URL: BASE,
		BKASH_USERNAME: "user",
		BKASH_PASSWORD: "pass",
		BKASH_APP_KEY: "key",
		BKASH_APP_SECRET: "secret",
	}))
		vi.stubEnv(k, v);
	return (await import("../../src/app/lib/payment.js")).paymentProvider;
};

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			const path = url.replace(BASE, "");
			calls.push({
				path,
				headers: init.headers as Record<string, string>,
				body: JSON.parse(String(init.body)),
			});
			const next = replies[path]?.shift() ?? {
				statusCode: "9999",
				statusMessage: "Unexpected",
			};
			return new Response(JSON.stringify(next));
		}),
	);
	reply("/tokenized/checkout/token/grant", {
		statusCode: "0000",
		id_token: "TOKEN",
		expires_in: 3600,
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("bKash provider", () => {
	it("grants a token once and creates a payment", async () => {
		const provider = await loadProvider();
		expect(provider).toMatchObject({ name: "bkash", label: "bKash sandbox" });
		reply(
			"/tokenized/checkout/create",
			{ statusCode: "0000", paymentID: "P1", bkashURL: "https://pay/1" },
			{ statusCode: "0000", paymentID: "P2", bkashURL: "https://pay/2" },
		);
		const input = {
			amount: 960,
			invoice: "pay_1",
			payerReference: "u-1",
			callbackURL: "http://api/cb",
		};
		expect(await provider.createPayment(input)).toEqual({
			providerPaymentId: "P1",
			redirectURL: "https://pay/1",
		});
		await provider.createPayment(input);

		const grants = calls.filter((c) => c.path.endsWith("/token/grant"));
		expect(grants).toHaveLength(1);
		expect(grants[0].headers).toMatchObject({
			username: "user",
			password: "pass",
		});
		expect(grants[0].body).toEqual({ app_key: "key", app_secret: "secret" });
		const create = calls.find((c) => c.path.endsWith("/create"));
		expect(create?.headers).toMatchObject({
			Authorization: "TOKEN",
			"X-App-Key": "key",
		});
		expect(create?.body).toEqual({
			mode: "0011",
			payerReference: "u-1",
			callbackURL: "http://api/cb",
			amount: "960.00",
			currency: "BDT",
			intent: "sale",
			merchantInvoiceNumber: "pay_1",
		});
	});

	it("reports a create error as a 502", async () => {
		const provider = await loadProvider();
		reply("/tokenized/checkout/create", {
			statusCode: "2001",
			statusMessage: "Invalid App Key",
		});
		await expect(
			provider.createPayment({
				amount: 300,
				invoice: "x",
				payerReference: "u",
				callbackURL: "http://cb",
			}),
		).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_GATEWAY" });
	});

	it("executes, falling back to the payment status", async () => {
		const provider = await loadProvider();
		reply("/tokenized/checkout/execute", {
			statusCode: "0000",
			transactionStatus: "Completed",
			trxID: "TRX1",
			customerMsisdn: "01770618575",
		});
		expect(await provider.executePayment("P1")).toEqual({
			status: "completed",
			trxId: "TRX1",
			payerNumber: "01770618575",
		});

		// Already executed (e.g. a repeated callback): the status call decides
		reply("/tokenized/checkout/execute", {
			statusCode: "2117",
			statusMessage: "Payment execution already been called before",
		});
		reply("/tokenized/checkout/payment/status", {
			statusCode: "0000",
			transactionStatus: "Completed",
			trxID: "TRX2",
		});
		expect(await provider.executePayment("P2")).toMatchObject({
			status: "completed",
			trxId: "TRX2",
		});

		reply("/tokenized/checkout/execute", {
			statusCode: "2056",
			statusMessage: "Invalid Payment State",
		});
		reply("/tokenized/checkout/payment/status", {
			statusCode: "0000",
			transactionStatus: "Initiated",
		});
		expect(await provider.executePayment("P3")).toEqual({
			status: "failed",
			reason: "Invalid Payment State (2056)",
		});
	});
});
