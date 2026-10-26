// Public teacher directory (/api/teachers). The signed-in teacher's own area is
// a separate module (/api/teacher).
import httpStatus from "http-status";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import type { TeacherPublic } from "../course/course.interface.js";
import {
	catalogWhere,
	teacherPublicInclude,
} from "../course/course.queries.js";
import {
	loadCatalogSummaries,
	sortSummaries,
} from "../course/course.service.js";
import { toTeacherPublic } from "../course/course.utils.js";

// Active teachers with at least one catalog course, most popular first: most
// students, then the best average rating, then the most reviews.
// q matches the name, the headline or the subject of one of their courses.
// featured=true: only the teachers an admin picked for the home page.
const listTeachers = async (
	q?: string,
	featured?: boolean,
): Promise<TeacherPublic[]> => {
	const rows = await prisma.teacherProfile.findMany({
		where: {
			user: { status: "active" },
			courses: { some: catalogWhere },
			...(featured === undefined ? {} : { featured }),
		},
		include: teacherPublicInclude,
	});
	const needle = q?.toLowerCase();
	return rows
		.filter(
			(t) =>
				!needle ||
				t.user.name.toLowerCase().includes(needle) ||
				t.headline.toLowerCase().includes(needle) ||
				t.courses.some((c) => c.subject.toLowerCase().includes(needle)),
		)
		.map(toTeacherPublic)
		.sort(
			(a, b) =>
				b.stats.students - a.stats.students ||
				b.stats.rating - a.stats.rating ||
				b.stats.reviewCount - a.stats.reviewCount ||
				a.name.localeCompare(b.name),
		);
};

// A banned or unknown teacher is a 404
const getTeacher = async (id: string) => {
	const row = await prisma.teacherProfile.findUnique({
		where: { id },
		include: teacherPublicInclude,
	});
	if (row?.user.status !== "active")
		throw new AppError(httpStatus.NOT_FOUND, "Teacher not found.");
	const courses = await loadCatalogSummaries({ teacherId: id });
	return {
		teacher: toTeacherPublic(row),
		courses: sortSummaries(courses, "popular"),
	};
};

export const TeachersService = { listTeachers, getTeacher };
