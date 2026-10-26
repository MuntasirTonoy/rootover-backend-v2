import httpStatus from "http-status";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";

// /api/teacher needs the teacher role AND a TeacherProfile (BACKEND_SPEC
// section 5). The route checks the role; every service starts here, and every
// query below it is scoped by the returned teacher id (ownership).
export const teacherOf = async (user: User) => {
	const teacher = await prisma.teacherProfile.findUnique({
		where: { userId: user.id },
	});
	if (!teacher)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only approved teachers can do this.",
		);
	return teacher;
};

// Transactions that write a whole course (many lesson rows) on Neon can
// outlast Prisma's 5 s default
export const LONG_TX = { maxWait: 10_000, timeout: 30_000 };
