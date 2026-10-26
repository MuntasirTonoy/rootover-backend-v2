// Home page picks (not in the spec; user's request, 2026-10-26): admins mark
// courses and teachers as featured. The home page lists catalog courses with
// featured=true and active teachers with featured=true (and a live course).
import httpStatus from "http-status";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";

// Only live (approved) courses can be featured; un-featuring always works
const setCourseFeatured = async (admin: User, id: string, featured: boolean) =>
	prisma.$transaction(async (tx) => {
		const course = await tx.course.findUnique({
			where: { id },
			select: { title: true, status: true, featured: true },
		});
		if (!course) throw new AppError(httpStatus.NOT_FOUND, "Course not found.");
		if (featured && course.status !== "approved")
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Only live (approved) courses can be featured.",
			);
		if (course.featured !== featured) {
			await tx.course.update({ where: { id }, data: { featured } });
			await logActivity(
				tx,
				admin,
				featured ? "Featured a course" : "Removed a featured course",
				course.title,
			);
		}
		return { id, featured };
	});

// Banned teachers can't be featured; un-featuring always works
const setTeacherFeatured = async (admin: User, id: string, featured: boolean) =>
	prisma.$transaction(async (tx) => {
		const teacher = await tx.teacherProfile.findUnique({
			where: { id },
			select: {
				featured: true,
				user: { select: { name: true, status: true } },
			},
		});
		if (!teacher)
			throw new AppError(httpStatus.NOT_FOUND, "Teacher not found.");
		if (featured && teacher.user.status !== "active")
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Banned teachers can't be featured.",
			);
		if (teacher.featured !== featured) {
			await tx.teacherProfile.update({ where: { id }, data: { featured } });
			await logActivity(
				tx,
				admin,
				featured ? "Featured a teacher" : "Removed a featured teacher",
				teacher.user.name,
			);
		}
		return { id, featured };
	});

export const AdminFeaturedService = { setCourseFeatured, setTeacherFeatured };
