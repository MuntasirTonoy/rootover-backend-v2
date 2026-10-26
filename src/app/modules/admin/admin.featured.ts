// Home page picks (not in the spec; user's request, 2026-10-26): admins mark
// teachers as featured; the home page lists active teachers with featured=true
// (and a live course). Featured courses are simply the 4 most popular ones.
import httpStatus from "http-status";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";

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

export const AdminFeaturedService = { setTeacherFeatured };
