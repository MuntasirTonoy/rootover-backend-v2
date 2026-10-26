// Student pages (/api/me/*): My Classes, dashboard, saved lessons, purchase history
import httpStatus from "http-status";
import type { z } from "zod";
import type { Prisma, User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import {
	catalogWhere,
	courseSummaryInclude,
} from "../course/course.queries.js";
import {
	progressOf,
	resumeLessonId,
	toCourseSummary,
} from "../course/course.utils.js";
import {
	purchaseViewInclude,
	toEnrollmentResponse,
	toPurchaseView,
} from "../purchase/purchase.utils.js";
import type {
	EnrolledCourse,
	SavedLessonView,
	StudentDashboard,
} from "./student.interface.js";
import type { StudentValidation } from "./student.validation.js";

type EnrollmentQuery = z.infer<typeof StudentValidation.enrollments>["query"];
type SavedQuery = z.infer<typeof StudentValidation.savedLessons>["query"];
type SaveInput = z.infer<typeof StudentValidation.saveLesson>["body"];

const ordered = { orderBy: { position: "asc" } } as const;

const enrolledInclude = {
	completions: { select: { lessonId: true } },
	course: {
		include: {
			...courseSummaryInclude,
			chapters: {
				...ordered,
				select: {
					id: true,
					title: true,
					lessons: {
						...ordered,
						select: { id: true, title: true, durationMin: true },
					},
				},
			},
		},
	},
} satisfies Prisma.EnrollmentInclude;

type EnrolledRow = Prisma.EnrollmentGetPayload<{
	include: typeof enrolledInclude;
}>;

const toEnrolledCourse = (row: EnrolledRow): EnrolledCourse => {
	const lessons = row.course.chapters.flatMap((ch) =>
		ch.lessons.map((l) => ({ ...l, chapterTitle: ch.title })),
	);
	const lessonIds = lessons.map((l) => l.id);
	const completedIds = row.completions.map((c) => c.lessonId);
	const last = lessons.find((l) => l.id === row.lastLessonId);
	return {
		enrollment: toEnrollmentResponse(row, completedIds),
		course: toCourseSummary(row.course),
		progress: progressOf(lessonIds, completedIds),
		resumeLessonId: resumeLessonId(lessonIds, completedIds, row.lastLessonId),
		lastLesson: last
			? { id: last.id, title: last.title, chapterTitle: last.chapterTitle }
			: undefined,
	};
};

// Most recently watched first; never-watched courses after, newest enrollment first
const byRecentActivity = (a: EnrolledCourse, b: EnrolledCourse) =>
	(b.enrollment.lastWatchedAt ?? "").localeCompare(
		a.enrollment.lastWatchedAt ?? "",
	) || b.enrollment.enrolledAt.localeCompare(a.enrollment.enrolledAt);

// Every enrollment is listed, even if the course later left the catalog: the
// student paid for it
const loadEnrolled = async (studentId: string) => {
	const rows = await prisma.enrollment.findMany({
		where: { studentId },
		include: enrolledInclude,
	});
	return rows.map(toEnrolledCourse).sort(byRecentActivity);
};

const progressState = (p: EnrolledCourse["progress"]) =>
	p.percent === 100 ? "completed" : p.completed ? "in-progress" : "not-started";

const listEnrollments = async (user: User, query: EnrollmentQuery) => {
	const q = query.q?.toLowerCase();
	return (await loadEnrolled(user.id)).filter(
		({ course, progress }) =>
			(!q ||
				[course.title, course.subject, course.teacher.name].some((s) =>
					s.toLowerCase().includes(q),
				)) &&
			(!query.level || course.level === query.level) &&
			(!query.progress || progressState(progress) === query.progress),
	);
};

// ------------------------------------------------------------ saved lessons

const savedInclude = {
	course: {
		select: {
			id: true,
			title: true,
			level: true,
			subject: true,
			thumbnail: true,
			teacher: { select: { id: true, user: { select: { name: true } } } },
		},
	},
	lesson: {
		select: {
			id: true,
			title: true,
			durationMin: true,
			chapter: { select: { id: true, title: true, position: true } },
		},
	},
} satisfies Prisma.SavedLessonInclude;

type SavedRow = Prisma.SavedLessonGetPayload<{ include: typeof savedInclude }>;

const toSavedView = (row: SavedRow): SavedLessonView => ({
	id: row.id,
	savedAt: row.savedAt.toISOString(),
	course: {
		id: row.course.id,
		title: row.course.title,
		level: row.course.level,
		subject: row.course.subject,
		thumbnail: row.course.thumbnail ?? undefined,
	},
	teacher: { id: row.course.teacher.id, name: row.course.teacher.user.name },
	lesson: {
		id: row.lesson.id,
		title: row.lesson.title,
		durationMin: row.lesson.durationMin,
	},
	chapter: {
		id: row.lesson.chapter.id,
		title: row.lesson.chapter.title,
		index: row.lesson.chapter.position,
	},
});

// Deleting a lesson deletes its saved rows (cascade), so every row is live
const loadSaved = async (studentId: string) =>
	(
		await prisma.savedLesson.findMany({
			where: { studentId },
			include: savedInclude,
			orderBy: [{ savedAt: "desc" }, { id: "asc" }],
		})
	).map(toSavedView);

const listSaved = async (user: User, query: SavedQuery) => {
	const q = query.q?.toLowerCase();
	return (await loadSaved(user.id)).filter(
		(s) =>
			(!query.courseId || s.course.id === query.courseId) &&
			(!q ||
				[s.lesson.title, s.chapter.title, s.course.title, s.teacher.name].some(
					(t) => t.toLowerCase().includes(q),
				)),
	);
};

// A student may save any lesson they can watch: every lesson of an enrolled
// course, or a free preview of a catalog course
const saveLesson = async (user: User, input: SaveInput) => {
	const lesson = await prisma.lesson.findFirst({
		where: { id: input.lessonId, chapter: { courseId: input.courseId } },
		select: { id: true, isPreview: true },
	});
	if (!lesson) throw new AppError(httpStatus.NOT_FOUND, "Lesson not found.");

	const enrolled = await prisma.enrollment.findUnique({
		where: {
			studentId_courseId: { studentId: user.id, courseId: input.courseId },
		},
		select: { id: true },
	});
	const publicPreview =
		lesson.isPreview &&
		(await prisma.course.count({
			where: { AND: [catalogWhere, { id: input.courseId }] },
		})) > 0;
	if (!enrolled && !publicPreview)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only save lessons you can watch.",
		);

	const existing = await prisma.savedLesson.findUnique({
		where: { studentId_lessonId: { studentId: user.id, lessonId: lesson.id } },
		select: { id: true },
	});
	if (existing)
		throw new AppError(httpStatus.CONFLICT, "This lesson is already saved.");

	const saved = await prisma.savedLesson.create({
		data: { studentId: user.id, courseId: input.courseId, lessonId: lesson.id },
		include: savedInclude,
	});
	return toSavedView(saved);
};

// Idempotent: removing a lesson that isn't saved is not an error
const unsaveLesson = async (user: User, lessonId: string) => {
	await prisma.savedLesson.deleteMany({
		where: { studentId: user.id, lessonId },
	});
};

// ------------------------------------------------------------ purchases

const loadPurchases = async (studentId: string, take?: number) =>
	(
		await prisma.purchase.findMany({
			where: { studentId },
			include: purchaseViewInclude,
			orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			take,
		})
	).map(toPurchaseView);

// Refunded purchases stay in the list but don't count toward the totals
const listPurchases = async (user: User) => {
	const purchases = await loadPurchases(user.id);
	const completed = purchases.filter((p) => p.status === "completed");
	return {
		purchases,
		totals: {
			count: completed.length,
			paid: completed.reduce((s, p) => s + p.amountPaid, 0),
			saved: completed.reduce((s, p) => s + p.listPrice - p.amountPaid, 0),
		},
	};
};

// ------------------------------------------------------------ dashboard

const getDashboard = async (user: User): Promise<StudentDashboard> => {
	const [enrolled, saved, recentPurchases, application] = await Promise.all([
		loadEnrolled(user.id),
		loadSaved(user.id),
		loadPurchases(user.id, 4),
		prisma.teacherApplication.findFirst({
			where: { userId: user.id },
			orderBy: { submittedAt: "desc" },
			select: {
				id: true,
				status: true,
				submittedAt: true,
				updatedAt: true,
				reviewNote: true,
			},
		}),
	]);

	const lessonsCompleted = enrolled.reduce(
		(s, e) => s + e.progress.completed,
		0,
	);
	const lessonsTotal = enrolled.reduce((s, e) => s + e.progress.total, 0);
	const recent = enrolled.filter(
		(e) => e.enrollment.lastWatchedAt && e.enrollment.lastLessonId,
	);

	return {
		stats: {
			enrolled: enrolled.length,
			lessonsCompleted,
			lessonsTotal,
			overallPercent: lessonsTotal
				? Math.round((lessonsCompleted / lessonsTotal) * 100)
				: 0,
			saved: saved.length,
		},
		// Unfinished courses, most recently watched first (all courses if none watched yet)
		continueLearning: (recent.length ? recent : enrolled)
			.filter((e) => e.progress.percent < 100)
			.slice(0, 3),
		recentlyWatched: recent.slice(0, 5),
		saved: saved.slice(0, 5),
		recentPurchases,
		application: application
			? {
					id: application.id,
					status: application.status,
					submittedAt: application.submittedAt.toISOString(),
					updatedAt: application.updatedAt.toISOString(),
					reviewNote: application.reviewNote ?? undefined,
				}
			: null,
	};
};

export const StudentService = {
	listEnrollments,
	listSaved,
	saveLesson,
	unsaveLesson,
	listPurchases,
	getDashboard,
};
