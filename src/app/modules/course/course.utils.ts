// Pure builders for the public course shapes. Ported from the frontend's
// selectors (courseRating, lessonAccess, progressOf, resumeLesson) so the
// numbers match what the mock showed.
import type { Lesson, User } from "../../../generated/prisma/client.js";
import { coursePrice, discountPercent } from "../../utils/pricing.js";
import { toTeacherProfileResponse } from "../user/user.utils.js";
import type {
	ChapterPublic,
	CourseAccess,
	CourseResponse,
	CourseSummary,
	LessonPublic,
	Progress,
	Rating,
	ReviewResponse,
	TeacherPublic,
} from "./course.interface.js";
import type {
	CourseDetailRow,
	CourseFullRow,
	CourseSummaryRow,
	TeacherPublicRow,
} from "./course.queries.js";

// Average rounded to one decimal; 0 when there are no reviews
export const ratingOf = (reviews: { rating: number }[]): Rating => {
	const count = reviews.length;
	const average = count
		? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10
		: 0;
	return { average, count };
};

export const toCourseSummary = (row: CourseSummaryRow): CourseSummary => {
	const lessons = row.chapters.flatMap((ch) => ch.lessons);
	return {
		id: row.id,
		level: row.level,
		subject: row.subject,
		title: row.title,
		thumbnail: row.thumbnail ?? undefined,
		price: row.price,
		discountPrice: row.discountPrice ?? undefined,
		effectivePrice: coursePrice(row),
		discountPercent: discountPercent(row),
		teacher: {
			id: row.teacher.id,
			name: row.teacher.user.name,
			avatar: row.teacher.user.avatar ?? undefined,
		},
		rating: ratingOf(row.reviews),
		studentCount: row._count.enrollments,
		lessonCount: lessons.length,
		chapterCount: row.chapters.length,
		durationMin: lessons.reduce((s, l) => s + l.durationMin, 0),
		featured: row.featured,
		createdAt: row.createdAt.toISOString(),
	};
};

export const toTeacherPublic = (row: TeacherPublicRow): TeacherPublic => {
	const reviews = row.courses.flatMap((c) => c.reviews);
	const students = new Set(
		row.courses.flatMap((c) => c.enrollments.map((e) => e.studentId)),
	);
	const { user, courses: _courses, ...profile } = row;
	return {
		...toTeacherProfileResponse(profile),
		name: user.name,
		avatar: user.avatar ?? undefined,
		status: user.status,
		stats: {
			courses: row.courses.length,
			students: students.size,
			rating: ratingOf(reviews).average,
			reviewCount: reviews.length,
		},
	};
};

// Who may watch which lessons (BACKEND_SPEC section 7):
// full = enrolled || owner || admin; a lesson is watchable when full or a preview
export const courseAccess = (
	user: Pick<User, "id" | "role"> | null | undefined,
	opts: { enrolled: boolean; ownerUserId: string },
): CourseAccess => {
	const owner = !!user && user.id === opts.ownerUserId;
	const full = opts.enrolled || owner || user?.role === "admin";
	return { enrolled: opts.enrolled, owner, full };
};

export const canWatch = (
	access: CourseAccess,
	lesson: Pick<Lesson, "isPreview">,
) => access.full || lesson.isPreview;

// Locked lessons never include their video or notes link
export const toLessonPublic = (
	lesson: Lesson,
	access: CourseAccess,
): LessonPublic => {
	const watchable = canWatch(access, lesson);
	return {
		id: lesson.id,
		title: lesson.title,
		durationMin: lesson.durationMin,
		videoUrl: watchable ? lesson.videoUrl : null,
		noteLink: watchable ? lesson.noteLink : null,
		isPreview: lesson.isPreview,
		canWatch: watchable,
	};
};

export const toChaptersPublic = (
	chapters: CourseDetailRow["chapters"],
	access: CourseAccess,
): ChapterPublic[] =>
	chapters.map((ch) => ({
		id: ch.id,
		title: ch.title,
		lessons: ch.lessons.map((l) => toLessonPublic(l, access)),
	}));

export const toReviewResponse = (
	r: CourseDetailRow["reviews"][number],
): ReviewResponse => ({
	id: r.id,
	studentName: r.studentName,
	rating: r.rating,
	comment: r.comment,
	date: r.date.toISOString(),
});

// Lessons in curriculum order (chapters and lessons are ordered by position)
export const flatLessons = (chapters: CourseDetailRow["chapters"]) =>
	chapters.flatMap((ch) => ch.lessons);

// Completed lessons that still exist in the course
export const progressOf = (
	lessonIds: string[],
	completedIds: Iterable<string>,
): Progress => {
	const valid = new Set(lessonIds);
	let completed = 0;
	for (const id of new Set(completedIds)) if (valid.has(id)) completed++;
	const total = lessonIds.length;
	return {
		completed,
		total,
		percent: total ? Math.round((completed / total) * 100) : 0,
	};
};

// "Continue learning": the last watched lesson if it still exists, else the
// first lesson not completed, else the first lesson
export const resumeLessonId = (
	lessonIds: string[],
	completedIds: Iterable<string>,
	lastLessonId?: string | null,
) => {
	if (lastLessonId && lessonIds.includes(lastLessonId)) return lastLessonId;
	const done = new Set(completedIds);
	return lessonIds.find((id) => !done.has(id)) ?? lessonIds[0];
};

// Owner/admin view only (see CourseResponse)
export const toCourseResponse = (row: CourseFullRow): CourseResponse => ({
	id: row.id,
	teacherId: row.teacherId,
	level: row.level,
	subject: row.subject,
	title: row.title,
	description: row.description,
	thumbnail: row.thumbnail ?? undefined,
	outcomes: row.outcomes,
	price: row.price,
	discountPrice: row.discountPrice ?? undefined,
	status: row.status,
	statusNote: row.statusNote ?? undefined,
	chapters: row.chapters.map((ch) => ({
		id: ch.id,
		title: ch.title,
		lessons: ch.lessons.map((l) => ({
			id: l.id,
			title: l.title,
			durationMin: l.durationMin,
			videoUrl: l.videoUrl,
			noteLink: l.noteLink,
			isPreview: l.isPreview,
		})),
	})),
	reviews: row.reviews.map(toReviewResponse),
	featured: row.featured,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});
