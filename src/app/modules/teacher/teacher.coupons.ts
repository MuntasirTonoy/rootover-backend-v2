// The teacher's coupons (BACKEND_SPEC sections 6, 9 and 10.6). Codes are stored
// uppercase and are unique per teacher; checkout compares them case-insensitively.
import httpStatus from "http-status";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import { isPrismaKnownError } from "../../errors/handlePrismaError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import { teacherOf } from "./teacher.queries.js";
import { toCouponResponse } from "./teacher.utils.js";
import type { CouponBody } from "./teacher.validation.js";

const NOT_FOUND = "Coupon not found.";
const DUPLICATE_CODE = "You already have a coupon with this code.";

const duplicate = () =>
	new AppError(httpStatus.CONFLICT, DUPLICATE_CODE, { code: DUPLICATE_CODE });

// A coupon may only target one of the teacher's own courses (or all of them)
const assertOwnCourse = async (teacherId: string, courseId: string | null) => {
	if (!courseId) return;
	const owned = await prisma.course.count({
		where: { id: courseId, teacherId },
	});
	if (!owned) {
		const message = "Choose one of your courses.";
		throw new AppError(httpStatus.BAD_REQUEST, message, { courseId: message });
	}
};

// Friendly 409 first; the unique index still catches two requests racing
const assertCodeFree = async (
	teacherId: string,
	code: string,
	exceptId?: string,
) => {
	const taken = await prisma.coupon.count({
		where: {
			teacherId,
			code: { equals: code, mode: "insensitive" },
			id: exceptId ? { not: exceptId } : undefined,
		},
	});
	if (taken) throw duplicate();
};

const rethrowDuplicate = (err: unknown): never => {
	if (isPrismaKnownError(err) && err.code === "P2002") throw duplicate();
	throw err;
};

const ownCoupon = async (teacherId: string, id: string) => {
	const coupon = await prisma.coupon.findFirst({ where: { id, teacherId } });
	if (!coupon) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	return coupon;
};

// Newest first, each with its computed state
const listCoupons = async (user: User) => {
	const teacher = await teacherOf(user);
	const coupons = await prisma.coupon.findMany({
		where: { teacherId: teacher.id },
		orderBy: [{ createdAt: "desc" }, { id: "asc" }],
	});
	const now = Date.now();
	return coupons.map((c) => toCouponResponse(c, now));
};

const createCoupon = async (user: User, body: CouponBody) => {
	const teacher = await teacherOf(user);
	await assertOwnCourse(teacher.id, body.courseId);
	await assertCodeFree(teacher.id, body.code);
	const coupon = await prisma
		.$transaction(async (tx) => {
			const created = await tx.coupon.create({
				data: { ...body, teacherId: teacher.id },
			});
			await logActivity(tx, user, "Created a coupon", created.code);
			return created;
		})
		.catch(rethrowDuplicate);
	return toCouponResponse(coupon);
};

// Replaces the editable fields; usedCount is kept
const updateCoupon = async (user: User, id: string, body: CouponBody) => {
	const teacher = await teacherOf(user);
	await ownCoupon(teacher.id, id);
	await assertOwnCourse(teacher.id, body.courseId);
	await assertCodeFree(teacher.id, body.code, id);
	const coupon = await prisma.coupon
		.update({ where: { id }, data: body })
		.catch(rethrowDuplicate);
	return toCouponResponse(coupon);
};

const setCouponActive = async (user: User, id: string, active: boolean) => {
	const teacher = await teacherOf(user);
	await ownCoupon(teacher.id, id);
	const coupon = await prisma.coupon.update({
		where: { id },
		data: { active },
	});
	return toCouponResponse(coupon);
};

// Past purchases keep the code as text, so deleting never touches history
const deleteCoupon = async (user: User, id: string) => {
	const teacher = await teacherOf(user);
	const { count } = await prisma.coupon.deleteMany({
		where: { id, teacherId: teacher.id },
	});
	if (!count) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
};

export const TeacherCouponService = {
	listCoupons,
	createCoupon,
	updateCoupon,
	setCouponActive,
	deleteCoupon,
};
