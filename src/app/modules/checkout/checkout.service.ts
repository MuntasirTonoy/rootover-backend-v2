// Checkout (BACKEND_SPEC sections 6, 7 and 10.4), paid through bKash
import httpStatus from "http-status";
import type { z } from "zod";
import type { Coupon, User } from "../../../generated/prisma/client.js";
import config from "../../../config/index.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { checkCoupon, quote } from "../../utils/pricing.js";
import { catalogWhere } from "../course/course.queries.js";
import { PaymentService } from "../payment/payment.service.js";
import { SettingsService } from "../settings/settings.service.js";
import type { CheckoutValidation } from "./checkout.validation.js";

type QuoteInput = z.infer<typeof CheckoutValidation.quote>["body"];
type CheckoutInput = z.infer<typeof CheckoutValidation.checkout>["body"];

const ALREADY_OWNED = "You already own this course.";

const requireStudent = (user: User) => {
	if (user.role !== "student")
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only student accounts can buy courses.",
		);
};

// Only catalog courses can be bought
const purchasableCourse = async (courseId: string) => {
	const course = await prisma.course.findFirst({
		where: { AND: [catalogWhere, { id: courseId }] },
		select: {
			id: true,
			title: true,
			teacherId: true,
			price: true,
			discountPrice: true,
		},
	});
	if (!course)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			"This course isn't available for purchase.",
		);
	return course;
};

const ensureNotOwned = async (studentId: string, courseId: string) => {
	const owned = await prisma.enrollment.findUnique({
		where: { studentId_courseId: { studentId, courseId } },
		select: { id: true },
	});
	if (owned) throw new AppError(httpStatus.CONFLICT, ALREADY_OWNED);
};

// Every coupon with this code (any teacher), then the spec's ordered checks.
// Failures are 422 with the frontend's message on `couponCode`.
const resolveCoupon = async (
	course: { id: string; teacherId: string },
	code: string,
): Promise<Coupon> => {
	const coupons = await prisma.coupon.findMany({
		where: { code: { equals: code.trim(), mode: "insensitive" } },
	});
	const check = checkCoupon(coupons, course, code);
	if (!check.ok)
		throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, check.error, {
			couponCode: check.error,
		});
	return check.coupon;
};

const toCouponPublic = (c: Coupon) => ({
	code: c.code,
	type: c.type,
	value: c.value,
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
	return PaymentService.startCoursePayment(user, {
		course,
		coupon,
		quote: quote(course, coupon, (await SettingsService.get()).commissionRate),
	});
};

export const CheckoutService = { getQuote, validCouponCodes, checkout };
