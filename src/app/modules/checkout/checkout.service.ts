// Checkout (BACKEND_SPEC sections 6, 7 and 10.4), paid through bKash.
// "Buy now" pays for one course; the cart (user's request, 2026-11-20) pays
// for several courses in one bKash payment, each with its own coupon.
import httpStatus from "http-status";
import type { z } from "zod";
import type { Coupon, User } from "../../../generated/prisma/client.js";
import config from "../../../config/index.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { checkCoupon, quote } from "../../utils/pricing.js";
import { catalogWhere } from "../course/course.queries.js";
import {
	type CoursePaymentLine,
	PaymentService,
} from "../payment/payment.service.js";
import { SettingsService } from "../settings/settings.service.js";
import type { CheckoutValidation } from "./checkout.validation.js";

type QuoteInput = z.infer<typeof CheckoutValidation.quote>["body"];
type CheckoutInput = z.infer<typeof CheckoutValidation.checkout>["body"];
type CartInput = z.infer<typeof CheckoutValidation.cart>["body"];

const ALREADY_OWNED = "You already own this course.";
const UNAVAILABLE = "This course isn't available for purchase.";

const requireStudent = (user: User) => {
	if (user.role !== "student")
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only student accounts can buy courses.",
		);
};

const courseSelect = {
	id: true,
	title: true,
	teacherId: true,
	price: true,
	discountPrice: true,
	level: true,
	subject: true,
	thumbnail: true,
	teacher: { select: { user: { select: { name: true } } } },
} as const;

// Only catalog courses can be bought; null when this one can't
const findPurchasable = (courseId: string) =>
	prisma.course.findFirst({
		where: { AND: [catalogWhere, { id: courseId }] },
		select: courseSelect,
	});

type PurchasableCourse = NonNullable<
	Awaited<ReturnType<typeof findPurchasable>>
>;

const purchasableCourse = async (courseId: string) => {
	const course = await findPurchasable(courseId);
	if (!course) throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, UNAVAILABLE);
	return course;
};

const isOwned = async (studentId: string, courseId: string) =>
	!!(await prisma.enrollment.findUnique({
		where: { studentId_courseId: { studentId, courseId } },
		select: { id: true },
	}));

const ensureNotOwned = async (studentId: string, courseId: string) => {
	if (await isOwned(studentId, courseId))
		throw new AppError(httpStatus.CONFLICT, ALREADY_OWNED);
};

// Every coupon with this code (any teacher), then the spec's ordered checks
const checkCode = async (
	course: { id: string; teacherId: string },
	code: string,
) => {
	const coupons = await prisma.coupon.findMany({
		where: { code: { equals: code.trim(), mode: "insensitive" } },
	});
	return checkCoupon(coupons, course, code);
};

// Failures are 422 with the frontend's message on `field` (couponCode, or
// items.<i>.couponCode in a cart)
const resolveCoupon = async (
	course: { id: string; teacherId: string },
	code: string,
	field = "couponCode",
): Promise<Coupon> => {
	const check = await checkCode(course, code);
	if (!check.ok)
		throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, check.error, {
			[field]: check.error,
		});
	return check.coupon;
};

const toCouponPublic = (c: Coupon) => ({
	code: c.code,
	type: c.type,
	value: c.value,
});

// What the cart page shows for a course
const toCartCourse = (c: PurchasableCourse) => ({
	id: c.id,
	title: c.title,
	level: c.level,
	subject: c.subject,
	thumbnail: c.thumbnail ?? undefined,
	teacher: { name: c.teacher.user.name },
});

const getQuote = async (user: User, input: QuoteInput) => {
	requireStudent(user);
	const course = await purchasableCourse(input.courseId);
	const coupon = input.couponCode
		? await resolveCoupon(course, input.couponCode)
		: null;
	return {
		quote: quote(course, coupon, (await SettingsService.get()).commissionRate),
		coupon: coupon ? toCouponPublic(coupon) : null,
	};
};

// Demo hint at checkout: codes that would work for this course right now
const validCouponCodes = async (user: User, courseId: string) => {
	// Would hand out every working coupon code: demo deployments only
	if (!config.demo_mode) throw new AppError(httpStatus.NOT_FOUND, "Not found.");
	requireStudent(user);
	const course = await purchasableCourse(courseId);
	const coupons = await prisma.coupon.findMany({
		where: {
			teacherId: course.teacherId,
			OR: [{ courseId: null }, { courseId: course.id }],
		},
		orderBy: { createdAt: "asc" },
	});
	return coupons
		.filter((c) => checkCoupon([c], course, c.code).ok)
		.map((c) => c.code);
};

// POST /api/checkout: starts a bKash payment for the quoted total and answers
// { paymentId, redirectURL }. The purchase and enrollment are written when
// bKash confirms the payment (see the payment module).
const checkout = async (user: User, input: CheckoutInput) => {
	requireStudent(user);
	const course = await purchasableCourse(input.courseId);
	await ensureNotOwned(user.id, course.id);
	const coupon = input.couponCode
		? await resolveCoupon(course, input.couponCode)
		: null;
	const rate = (await SettingsService.get()).commissionRate;
	return PaymentService.startCoursePayment(user, [
		{ course, coupon, quote: quote(course, coupon, rate) },
	]);
};

// POST /api/checkout/cart/quote: prices every course of the cart. Never fails
// for one course: an unavailable or owned course comes back with `error`, a bad
// coupon with `couponError` (priced without it), so the page can show each.
// `total` covers the courses that can be bought. Guests (no user) get prices
// without the ownership check.
const cartQuote = async (user: User | undefined, input: CartInput) => {
	if (user) requireStudent(user);
	const rate = (await SettingsService.get()).commissionRate;
	const items = await Promise.all(
		input.items.map(async ({ courseId, couponCode }) => {
			const course = await findPurchasable(courseId);
			if (!course) return { courseId, error: UNAVAILABLE };
			const shown = toCartCourse(course);
			if (user && (await isOwned(user.id, courseId)))
				return { courseId, course: shown, error: ALREADY_OWNED };
			const check = couponCode ? await checkCode(course, couponCode) : null;
			const coupon = check?.ok ? check.coupon : null;
			return {
				courseId,
				course: shown,
				quote: quote(course, coupon, rate),
				coupon: coupon ? toCouponPublic(coupon) : null,
				couponError: check && !check.ok ? check.error : undefined,
			};
		}),
	);
	return {
		items,
		total: items.reduce((sum, i) => sum + (i.quote?.total ?? 0), 0),
	};
};

// POST /api/checkout/cart: one bKash payment for every course in the cart.
// Strict: any problem fails the whole request (409 for an owned course, 422
// with `items.<i>.couponCode` for a coupon), so nothing is paid by surprise.
const cartCheckout = async (user: User, input: CartInput) => {
	requireStudent(user);
	const rate = (await SettingsService.get()).commissionRate;
	const lines: CoursePaymentLine[] = [];
	for (const [i, { courseId, couponCode }] of input.items.entries()) {
		const course = await findPurchasable(courseId);
		if (!course)
			throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, UNAVAILABLE, {
				[`items.${i}.courseId`]: UNAVAILABLE,
			});
		if (await isOwned(user.id, courseId))
			throw new AppError(
				httpStatus.CONFLICT,
				`You already own "${course.title}". Remove it from your cart.`,
				{ [`items.${i}.courseId`]: ALREADY_OWNED },
			);
		const coupon = couponCode
			? await resolveCoupon(course, couponCode, `items.${i}.couponCode`)
			: null;
		lines.push({ course, coupon, quote: quote(course, coupon, rate) });
	}
	return PaymentService.startCoursePayment(
		user,
		lines,
		(i) => `items.${i}.couponCode`,
	);
};

export const CheckoutService = {
	getQuote,
	validCouponCodes,
	checkout,
	cartQuote,
	cartCheckout,
};
