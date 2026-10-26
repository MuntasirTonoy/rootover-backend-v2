import httpStatus from "http-status";
import type { z } from "zod";
import type { Prisma, User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { LEVELS } from "../../utils/constants.js";
import { paginateArray } from "../../utils/pagination.js";
import type {
	CourseDetail,
	CourseSummary,
	FreePreview,
} from "./course.interface.js";
import {
	catalogWhere,
	courseDetailInclude,
	courseSummaryInclude,
	teacherPublicInclude,
} from "./course.queries.js";
import {
	courseAccess,
	flatLessons,
	progressOf,
	resumeLessonId,
	toChaptersPublic,
	toCourseSummary,
	toLessonPublic,
	toTeacherPublic,
} from "./course.utils.js";
import type { COURSE_SORTS, CourseValidation } from "./course.validation.js";

type ListQuery = z.infer<typeof CourseValidation.listCourses>["query"];
type CourseSort = (typeof COURSE_SORTS)[number];

const COURSE_NOT_FOUND = "Course not found.";

const priceTests = {
	under1000: (p: number) => p < 1000,
	"1000-2000": (p: number) => p >= 1000 && p <= 2000,
	over2000: (p: number) => p > 2000,
} as const;

// Newest first, then id: a stable tie-breaker so pages never overlap
const byNewest = (a: CourseSummary, b: CourseSummary) =>
	b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

const comparators: Record<
	CourseSort,
	(a: CourseSummary, b: CourseSummary) => number
> = {
	// Most students, then the best rated (the home page's featured courses)
	popular: (a, b) =>
		b.studentCount - a.studentCount ||
		b.rating.average - a.rating.average ||
		b.rating.count - a.rating.count ||
		byNewest(a, b),
	rating: (a, b) =>
		b.rating.average - a.rating.average ||
		b.rating.count - a.rating.count ||
		byNewest(a, b),
	newest: byNewest,
	"price-asc": (a, b) => a.effectivePrice - b.effectivePrice || byNewest(a, b),
	"price-desc": (a, b) => b.effectivePrice - a.effectivePrice || byNewest(a, b),
};

export const sortSummaries = (list: CourseSummary[], sort: CourseSort) =>
	[...list].sort(comparators[sort]);

// Summaries of catalog courses matching `where`. The price filter and every
// sort use derived values (effective price, students, rating), so they run on
// the summaries; fine at catalog scale, move to SQL if it grows to thousands.
export const loadCatalogSummaries = async (
	where: Prisma.CourseWhereInput = {},
) => {
	const rows = await prisma.course.findMany({
		where: { AND: [catalogWhere, where] },
		include: courseSummaryInclude,
	});
	return rows.map(toCourseSummary);
};

// q matches title, subject, level or teacher name, case-insensitively
const searchWhere = (q: string): Prisma.CourseWhereInput => {
	const needle = q.toLowerCase();
	const levels = LEVELS.filter((l) => l.toLowerCase().includes(needle));
	return {
		OR: [
			{ title: { contains: q, mode: "insensitive" } },
			{ subject: { contains: q, mode: "insensitive" } },
			{ teacher: { user: { name: { contains: q, mode: "insensitive" } } } },
			...(levels.length ? [{ level: { in: [...levels] } }] : []),
		],
	};
};

const listCourses = async (query: ListQuery) => {
	const filters: Prisma.CourseWhereInput[] = [];
	if (query.q) filters.push(searchWhere(query.q));
	if (query.level) filters.push({ level: query.level });
	if (query.subject)
		filters.push({ subject: { equals: query.subject, mode: "insensitive" } });
	if (query.teacherId) filters.push({ teacherId: query.teacherId });
	if (query.featured !== undefined) filters.push({ featured: query.featured });

	let summaries = await loadCatalogSummaries({ AND: filters });
	if (query.price) {
		const test = priceTests[query.price];
		summaries = summaries.filter((s) => test(s.effectivePrice));
	}
	return paginateArray(
		sortSummaries(summaries, query.sort),
		query.page,
		query.limit,
	);
};

// Filter options for the catalog page (catalog courses only)
const facets = async () => {
	const rows = await prisma.course.findMany({
		where: catalogWhere,
		select: {
			level: true,
			subject: true,
			teacher: { select: { id: true, user: { select: { name: true } } } },
		},
	});
	const teachers = new Map(
		rows.map((r) => [r.teacher.id, r.teacher.user.name]),
	);
	return {
		levels: LEVELS.map((level) => ({
			level,
			count: rows.filter((r) => r.level === level).length,
		})),
		subjects: [...new Set(rows.map((r) => r.subject))].sort((a, b) =>
			a.localeCompare(b),
		),
		teachers: [...teachers]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
};

// Course details with an access-filtered curriculum. A course outside the
// catalog is a 404, except to its owner and admins (shown with its status).
const getCourse = async (
	id: string,
	user: User | undefined,
): Promise<CourseDetail> => {
	const row = await prisma.course.findUnique({
		where: { id },
		include: {
			...courseDetailInclude,
			teacher: { include: teacherPublicInclude },
		},
	});
	if (!row) throw new AppError(httpStatus.NOT_FOUND, COURSE_NOT_FOUND);

	const published =
		row.status === "approved" && row.teacher.user.status === "active";
	const owner = !!user && user.id === row.teacher.userId;
	if (!published && !owner && user?.role !== "admin")
		throw new AppError(httpStatus.NOT_FOUND, COURSE_NOT_FOUND);

	const enrollment = user
		? await prisma.enrollment.findUnique({
				where: { studentId_courseId: { studentId: user.id, courseId: id } },
				include: { completions: { select: { lessonId: true } } },
			})
		: null;
	const access = courseAccess(user, {
		enrolled: !!enrollment,
		ownerUserId: row.teacher.userId,
	});

	const { teacher: _summaryTeacher, ...summary } = toCourseSummary(row);
	const lessonIds = flatLessons(row.chapters).map((l) => l.id);
	const completedIds = enrollment?.completions.map((c) => c.lessonId) ?? [];

	return {
		...summary,
		description: row.description,
		outcomes: row.outcomes,
		status: row.status,
		statusNote: row.statusNote ?? undefined,
		published,
		chapters: toChaptersPublic(row.chapters, access),
		teacher: toTeacherPublic(row.teacher),
		access,
		enrollment: enrollment
			? {
					progress: progressOf(lessonIds, completedIds),
					resumeLessonId: resumeLessonId(
						lessonIds,
						completedIds,
						enrollment.lastLessonId,
					),
					// Only lessons that still exist in the course
					completedLessonIds: completedIds.filter((id) =>
						lessonIds.includes(id),
					),
					rated: !!enrollment.ratedAt,
				}
			: undefined,
	};
};

// Every preview lesson of every catalog course, most popular courses first
const freePreviews = async (): Promise<FreePreview[]> => {
	const rows = await prisma.course.findMany({
		where: {
			AND: [
				catalogWhere,
				{ chapters: { some: { lessons: { some: { isPreview: true } } } } },
			],
		},
		include: courseDetailInclude,
	});
	const guest = { enrolled: false, owner: false, full: false };
	const summaries = new Map(rows.map((r) => [r.id, toCourseSummary(r)]));
	return sortSummaries([...summaries.values()], "popular").flatMap(
		(summary) => {
			const row = rows.find((r) => r.id === summary.id);
			return (row?.chapters ?? []).flatMap((ch) =>
				ch.lessons
					.filter((l) => l.isPreview)
					.map((l) => ({
						course: summary,
						lesson: toLessonPublic(l, guest),
						chapterTitle: ch.title,
					})),
			);
		},
	);
};

export const CourseService = { listCourses, facets, getCourse, freePreviews };
