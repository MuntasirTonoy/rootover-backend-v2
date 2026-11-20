// Payments through the provider in lib/payment.ts (bKash Tokenized Checkout, or
// simulated in tests). A purchase or registration fee is only written once the
// provider has confirmed the money, server to server:
//
//   start*  -> Payment(initiated) + provider.createPayment -> { redirectURL }
//   payer approves on bKash -> bKash redirects the browser to handleCallback
//   handleCallback -> claim (initiated|expired -> processing) -> executePayment
//     -> completed: write the purchase/fee | failed: release the coupon
//   -> redirect to the frontend's /payment/result?id=<payment id>
//
// The callback's `status` query parameter is never trusted for success: only
// executePayment decides.
import httpStatus from "http-status";
import config from "../../../config/index.js";
import type {
	Payment,
	Prisma,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import { isPrismaKnownError } from "../../errors/handlePrismaError.js";
import {
	generateTrxId,
	type PaymentOutcome,
	paymentProvider,
} from "../../lib/payment.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import type { Quote } from "../../utils/pricing.js";
import {
	createTeacher,
	isTeacherCodeClash,
	photoAsAvatar,
} from "../application/application.approval.js";
import { toRegistrationFeeResponse } from "../application/application.utils.js";
import {
	toEnrollmentResponse,
	toPurchaseResponse,
} from "../purchase/purchase.utils.js";
import { SettingsService } from "../settings/settings.service.js";

type Tx = Prisma.TransactionClient;

// A payment nobody came back from is expired after this, releasing its coupon
const PAYMENT_TTL_MS = 30 * 60 * 1000;
// Recording a paid cart writes several rows per course, with a Neon round trip
// each. The money is already taken by then, so the transaction must not time
// out (Prisma's default is 5 s).
const FULFIL_TX = { maxWait: 10_000, timeout: 60_000 };
export const COUPON_EXHAUSTED = "This coupon has reached its usage limit.";

const callbackURL = () =>
	`${config.api_public_url}/api/payments/${paymentProvider.name}/callback`;
const resultURL = (query: Record<string, string>) =>
	`${config.frontend_url}/payment/result?${new URLSearchParams(query)}`;

// Takes one use of the coupon only while it is still valid, so concurrent
// buyers can never exceed its usage limit
const claimCoupon = async (tx: Tx, couponId: string) => {
	const { count } = await tx.coupon.updateMany({
		where: {
			id: couponId,
			active: true,
			expiresAt: { gte: new Date() },
			usedCount: { lt: tx.coupon.fields.usageLimit },
		},
		data: { usedCount: { increment: 1 } },
	});
	return count === 1;
};

// Every coupon use a payment reserved: one per course item (a cart may use the
// same coupon twice), or the payment's own coupon for pre-cart payments
const reservedCoupons = async (
	tx: Tx,
	payment: Pick<Payment, "id" | "couponId">,
) => {
	const items = await tx.paymentItem.findMany({
		where: { paymentId: payment.id, couponId: { not: null } },
		select: { couponId: true },
	});
	const ids = items.map((i) => i.couponId as string);
	return payment.couponId ? [...ids, payment.couponId] : ids;
};

// Gives the reserved uses back, once
const releaseCoupon = async (
	tx: Tx,
	payment: Pick<Payment, "id" | "couponId">,
) => {
	const coupons = await reservedCoupons(tx, payment);
	if (!coupons.length) return;
	const { count } = await tx.payment.updateMany({
		where: { id: payment.id, couponReleased: false },
		data: { couponReleased: true },
	});
	if (count)
		for (const id of coupons)
			await tx.coupon.updateMany({
				where: { id, usedCount: { gt: 0 } },
				data: { usedCount: { decrement: 1 } },
			});
};

// Payments left at bKash for longer than the TTL stop holding coupon uses
const expireStalePayments = async () => {
	const stale = await prisma.payment.findMany({
		where: {
			state: "initiated",
			createdAt: { lt: new Date(Date.now() - PAYMENT_TTL_MS) },
		},
		select: { id: true, couponId: true },
	});
	for (const p of stale)
		await prisma.$transaction(async (tx) => {
			const { count } = await tx.payment.updateMany({
				where: { id: p.id, state: "initiated" },
				data: { state: "expired" },
			});
			if (count) await releaseCoupon(tx, p);
		});
};

// Asks the provider for a payment page; a failure there undoes the reservation
const openPayment = async (payment: Payment, user: User) => {
	try {
		const created = await paymentProvider.createPayment({
			amount: payment.amount,
			invoice: payment.id,
			payerReference: user.id,
			callbackURL: callbackURL(),
		});
		await prisma.payment.update({
			where: { id: payment.id },
			data: { providerPaymentId: created.providerPaymentId },
		});
		return { paymentId: payment.id, redirectURL: created.redirectURL };
	} catch (err) {
		await prisma.$transaction(async (tx) => {
			await tx.payment.update({
				where: { id: payment.id },
				data: { state: "failed", failureReason: (err as Error).message },
			});
			await releaseCoupon(tx, payment);
		});
		throw err;
	}
};

// ------------------------------------------------------------ start

// One course of a payment: "Buy now" has one, a cart several
export interface CoursePaymentLine {
	course: { id: string; title: string; teacherId: string };
	coupon: { id: string; code: string } | null;
	quote: Quote;
}

// The caller has already checked the buyer, the courses, ownership and the
// coupons. `couponField(i)` names the field a used-up coupon is reported on.
const startCoursePayment = async (
	user: User,
	lines: CoursePaymentLine[],
	couponField: (index: number) => string = () => "couponCode",
) => {
	await expireStalePayments();
	const payment = await prisma.$transaction(async (tx) => {
		for (const [i, line] of lines.entries())
			if (line.coupon && !(await claimCoupon(tx, line.coupon.id)))
				throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, COUPON_EXHAUSTED, {
					[couponField(i)]: COUPON_EXHAUSTED,
				});
		return tx.payment.create({
			data: {
				purpose: "course_purchase",
				provider: paymentProvider.name,
				userId: user.id,
				// Kept for a single course so older views still show it
				courseId: lines.length === 1 ? lines[0].course.id : null,
				amount: lines.reduce((sum, l) => sum + l.quote.total, 0),
				items: {
					create: lines.map((l) => ({
						courseId: l.course.id,
						couponId: l.coupon?.id ?? null,
						quote: { ...l.quote, couponCode: l.coupon?.code ?? null },
						amount: l.quote.total,
					})),
				},
			},
		});
	});
	// A 100% coupon leaves nothing to charge
	if (payment.amount === 0) {
		await settle(payment, {
			status: "completed",
			trxId: generateTrxId("FREE"),
		});
		return {
			paymentId: payment.id,
			redirectURL: resultURL({ id: payment.id }),
		};
	}
	return openPayment(payment, user);
};

// The caller has already checked the application is the user's and awaits payment
const startFeePayment = async (user: User, applicationId: string) => {
	await expireStalePayments();
	const payment = await prisma.payment.create({
		data: {
			purpose: "registration_fee",
			provider: paymentProvider.name,
			userId: user.id,
			applicationId,
			// The fee in force now; a later change never alters a started payment
			amount: (await SettingsService.get()).registrationFee,
		},
	});
	return openPayment(payment, user);
};

// ------------------------------------------------------------ finish

type LineQuote = Quote & { couponCode: string | null };

export const ALREADY_OWNED_REFUND =
	"You already own this course. Contact support for a refund.";

// The courses of a confirmed course payment: its items, or for a payment made
// before the cart, its own course and quote
const courseLines = async (tx: Tx, payment: Payment) => {
	const items = await tx.paymentItem.findMany({
		where: { paymentId: payment.id },
		orderBy: { id: "asc" },
	});
	if (items.length)
		return items.map((i) => ({
			itemId: i.id as string | null,
			courseId: i.courseId,
			couponId: i.couponId,
			quote: i.quote as unknown as LineQuote,
		}));
	return [
		{
			itemId: null,
			courseId: payment.courseId ?? "",
			couponId: payment.couponId,
			quote: payment.quote as unknown as LineQuote,
		},
	];
};

// Writes a purchase + enrollment for each course. A course the buyer already
// owns by now (bought elsewhere while paying) is skipped and its item marked
// for a refund; if that leaves nothing, the payment fails asking for a refund.
const fulfilCourses = async (
	tx: Tx,
	payment: Payment,
	user: User,
	trxId: string,
) => {
	const lines = await courseLines(tx, payment);

	// An expired payment gave its coupon uses back; take them again if possible.
	// The buyer paid the discounted prices either way.
	if (payment.couponReleased) {
		let claimed = false;
		for (const line of lines)
			if (line.couponId && (await claimCoupon(tx, line.couponId)))
				claimed = true;
		if (claimed)
			await tx.payment.update({
				where: { id: payment.id },
				data: { couponReleased: false },
			});
	}

	const purchaseIds: string[] = [];
	for (const line of lines) {
		const q = line.quote;
		const course = await tx.course.findUniqueOrThrow({
			where: { id: line.courseId },
			select: { id: true, title: true, teacherId: true },
		});
		const owned = await tx.enrollment.findUnique({
			where: {
				studentId_courseId: { studentId: user.id, courseId: course.id },
			},
			select: { id: true },
		});
		if (owned) {
			if (line.itemId)
				await tx.paymentItem.update({
					where: { id: line.itemId },
					data: {
						refundNote: `Already owned when the payment completed: ৳${q.total} to refund.`,
					},
				});
			continue;
		}
		const purchase = await tx.purchase.create({
			data: {
				studentId: user.id,
				courseId: course.id,
				// Copied at purchase time: history never follows later course changes
				teacherId: course.teacherId,
				listPrice: q.listPrice,
				coursePrice: q.coursePrice,
				couponCode: q.couponCode,
				couponDiscount: q.couponDiscount,
				amountPaid: q.total,
				commission: q.commission,
				teacherNet: q.teacherNet,
				method: "bKash",
				trxId,
				status: "completed",
			},
		});
		await tx.enrollment.create({
			data: {
				studentId: user.id,
				courseId: course.id,
				purchaseId: purchase.id,
			},
		});
		if (line.itemId)
			await tx.paymentItem.update({
				where: { id: line.itemId },
				data: { purchaseId: purchase.id },
			});
		await logActivity(
			tx,
			user,
			`Purchased a course (${paymentProvider.label})`,
			course.title,
		);
		purchaseIds.push(purchase.id);
	}

	if (!purchaseIds.length)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			lines.length === 1
				? ALREADY_OWNED_REFUND
				: "You already own these courses. Contact support for a refund.",
		);
	// The single purchase stays linked on the payment, as before the cart
	return lines.length === 1 ? { purchaseId: purchaseIds[0] } : {};
};

// Writes what was paid for. If that's no longer possible (the course was bought
// meanwhile, the application was rejected) the payment is marked failed with a
// reason that asks for a refund; the trxId stays on it for support.
const fulfil = async (
	tx: Tx,
	payment: Payment,
	outcome: { trxId: string; payerNumber?: string },
) => {
	const user = await tx.user.findUniqueOrThrow({
		where: { id: payment.userId },
	});

	if (payment.purpose === "course_purchase")
		return fulfilCourses(tx, payment, user, outcome.trxId);

	// A paid fee approves the application straight away (user's request,
	// 2026-10-26): no separate admin verification step any more
	const application = await tx.teacherApplication.updateMany({
		where: {
			id: payment.applicationId ?? "",
			userId: user.id,
			status: "payment_required",
		},
		data: { status: "approved" },
	});
	if (application.count === 0)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			"Your application no longer needs a fee. Contact support for a refund.",
		);
	const fee = await tx.registrationFee.create({
		data: {
			applicationId: payment.applicationId ?? "",
			userId: user.id,
			amount: payment.amount,
			method: "bKash",
			payerNumber: outcome.payerNumber ?? "",
			trxId: outcome.trxId,
		},
	});
	await logActivity(
		tx,
		user,
		`Paid the teacher registration fee (${paymentProvider.label})`,
		`৳${payment.amount} via bKash`,
	);
	const { application: approved, teacher } = await createTeacher(
		tx,
		await tx.teacherApplication.findUniqueOrThrow({
			where: { id: payment.applicationId ?? "" },
		}),
	);
	await logActivity(
		tx,
		null,
		"Approved teacher application (registration fee paid)",
		`${approved.fullName} · ${teacher.teacherCode}`,
	);
	return { registrationFeeId: fee.id };
};

// Writes what was paid for and completes the payment, in one transaction.
// Retried when an automatic teacher approval loses a Teacher ID race.
const complete = async (
	payment: Payment,
	outcome: PaymentOutcome & { status: "completed" },
) => {
	for (let attempt = 1; ; attempt++) {
		try {
			return await prisma.$transaction(async (tx) => {
				const links = await fulfil(tx, payment, outcome);
				await tx.payment.update({
					where: { id: payment.id },
					data: {
						state: "completed",
						trxId: outcome.trxId,
						payerNumber: outcome.payerNumber,
						...links,
					},
				});
			}, FULFIL_TX);
		} catch (err) {
			if (!isTeacherCodeClash(err) || attempt >= 3) throw err;
		}
	}
};

const settle = async (payment: Payment, outcome: PaymentOutcome) => {
	if (outcome.status === "failed") {
		await prisma.$transaction(async (tx) => {
			await tx.payment.update({
				where: { id: payment.id },
				data: { state: "failed", failureReason: outcome.reason },
			});
			await releaseCoupon(tx, payment);
		});
		return;
	}
	try {
		await complete(payment, outcome);
	} catch (err) {
		const reason =
			err instanceof AppError
				? err.message
				: isPrismaKnownError(err) &&
						err.code === "P2002" &&
						payment.purpose === "course_purchase"
					? ALREADY_OWNED_REFUND
					: "We couldn't record this payment. Contact support with the transaction id.";
		console.error(
			`[payment] ${payment.id} paid (${outcome.trxId}) but not fulfilled: ${reason}`,
			err,
		);
		await prisma.payment.update({
			where: { id: payment.id },
			data: {
				state: "failed",
				failureReason: reason,
				trxId: outcome.trxId,
				payerNumber: outcome.payerNumber,
			},
		});
		return;
	}
	// The new teacher's application photo becomes their avatar (best-effort)
	if (payment.purpose === "registration_fee" && payment.applicationId) {
		const application = await prisma.teacherApplication.findUnique({
			where: { id: payment.applicationId },
			select: { userId: true, photo: true },
		});
		if (application) await photoAsAvatar(application.userId, application.photo);
	}
};

// GET /api/payments/<provider>/callback?paymentID=...&status=success|failure|cancel
// Always answers with a redirect to the frontend's result page.
const handleCallback = async (providerPaymentId: string, status: string) => {
	const payment = await prisma.payment.findUnique({
		where: { providerPaymentId },
	});
	if (!payment) return resultURL({ error: "not_found" });
	const result = resultURL({ id: payment.id });

	if (status !== "success") {
		await prisma.$transaction(async (tx) => {
			const { count } = await tx.payment.updateMany({
				where: { id: payment.id, state: { in: ["initiated", "expired"] } },
				data: {
					state: status === "cancel" ? "cancelled" : "failed",
					failureReason:
						status === "cancel"
							? "You cancelled the payment."
							: "The payment didn't go through.",
				},
			});
			if (count) await releaseCoupon(tx, payment);
		});
		return result;
	}

	// Only one callback gets to execute (a refresh or a double redirect is a no-op)
	const { count } = await prisma.payment.updateMany({
		where: { id: payment.id, state: { in: ["initiated", "expired"] } },
		data: { state: "processing" },
	});
	if (count === 0) return result;

	let outcome: PaymentOutcome;
	try {
		outcome = await paymentProvider.executePayment(providerPaymentId);
	} catch (err) {
		// Unknown result: back to initiated so a later callback (or support) can retry
		await prisma.payment.update({
			where: { id: payment.id },
			data: { state: "initiated" },
		});
		console.error(`[payment] execute failed for ${payment.id}`, err);
		return resultURL({ id: payment.id, error: "gateway" });
	}
	await settle(payment, outcome);
	return result;
};

// ------------------------------------------------------------ read

// The result page's view of one of the user's own payments
const getPayment = async (user: User, id: string) => {
	const p = await prisma.payment.findFirst({
		where: { id, userId: user.id },
		include: {
			course: { select: { id: true, title: true } },
			purchase: { include: { enrollment: true } },
			registrationFee: true,
			items: {
				orderBy: { id: "asc" },
				include: { course: { select: { id: true, title: true } } },
			},
		},
	});
	if (!p) throw new AppError(httpStatus.NOT_FOUND, "Payment not found.");
	// Every course of the payment (a payment from before the cart has just its course)
	const items = p.items.length
		? p.items.map((i) => ({
				course: i.course,
				amount: i.amount,
				granted: !!i.purchaseId,
				refundNote: i.refundNote ?? undefined,
			}))
		: p.course
			? [
					{
						course: p.course,
						amount: p.amount,
						granted: !!p.purchaseId,
						refundNote: undefined,
					},
				]
			: [];
	return {
		id: p.id,
		purpose: p.purpose,
		provider: p.provider,
		sandbox: p.provider === "bkash" && config.payment.bkash.sandbox,
		state: p.state,
		amount: p.amount,
		trxId: p.trxId ?? undefined,
		payerNumber: p.payerNumber ?? undefined,
		failureReason: p.failureReason ?? undefined,
		course: p.course ?? undefined,
		items,
		applicationId: p.applicationId ?? undefined,
		purchase: p.purchase ? toPurchaseResponse(p.purchase) : undefined,
		enrollment: p.purchase?.enrollment
			? toEnrollmentResponse(p.purchase.enrollment, [])
			: undefined,
		registrationFee: p.registrationFee
			? toRegistrationFeeResponse(p.registrationFee)
			: undefined,
		createdAt: p.createdAt.toISOString(),
		updatedAt: p.updatedAt.toISOString(),
	};
};

export const PaymentService = {
	startCoursePayment,
	startFeePayment,
	handleCallback,
	getPayment,
};
