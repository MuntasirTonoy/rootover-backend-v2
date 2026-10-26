// Course player (BACKEND_SPEC section 10.3). Visibility and lesson locking come
// from CourseService.getCourse, so the player and the details page always agree.
import httpStatus from "http-status";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import type {
	CourseDetail,
	Progress,
	ReviewResponse,
} from "../course/course.interface.js";
import { CourseService } from "../course/course.service.js";
import { progressOf, toReviewResponse } from "../course/course.utils.js";

export interface PlayerData {
	course: CourseDetail;
	savedLessonIds: string[];
	// Lessons this student already has an unresolved video report on
	myOpenReportLessonIds: string[];
}

const getPlayer = async (
	courseId: string,
	user: User | undefined,
): Promise<PlayerData> => {
	const course = await CourseService.getCourse(courseId, user);
	if (!user) return { course, savedLessonIds: [], myOpenReportLessonIds: [] };

	const [saved, reports] = await Promise.all([
		prisma.savedLesson.findMany({
			where: { studentId: user.id, courseId },
			select: { lessonId: true },
		}),
		prisma.videoReport.findMany({
			where: { reporterId: user.id, courseId, status: { not: "resolved" } },
			select: { lessonId: true },
		}),
	]);
	return {
		course,
		savedLessonIds: saved.map((s) => s.lessonId),
		myOpenReportLessonIds: [...new Set(reports.map((r) => r.lessonId))],
	};
};

// The lesson must belong to this course
const requireLesson = async (courseId: string, lessonId: string) => {
	const lesson = await prisma.lesson.findFirst({
		where: { id: lessonId, chapter: { courseId } },
		select: { id: true },
	});
	if (!lesson) throw new AppError(httpStatus.NOT_FOUND, "Lesson not found.");
};

const enrollmentOf = (studentId: string, courseId: string) =>
	prisma.enrollment.findUnique({
		where: { studentId_courseId: { studentId, courseId } },
	});

// Remembers where the student is ("continue learning"). A no-op when not
// enrolled (e.g. watching a free preview) or when nothing changed.
const recordWatch = async (user: User, courseId: string, lessonId: string) => {
	await requireLesson(courseId, lessonId);
	const enrollment = await enrollmentOf(user.id, courseId);
	if (!enrollment || enrollment.lastLessonId === lessonId) return;
	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: { lastLessonId: lessonId, lastWatchedAt: new Date() },
	});
};

const setComplete = async (
	user: User,
	courseId: string,
	lessonId: string,
	done: boolean,
): Promise<{ progress: Progress }> => {
	const enrollment = await enrollmentOf(user.id, courseId);
	if (!enrollment)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Enroll in this course to track your progress.",
		);
	await requireLesson(courseId, lessonId);

	if (done)
		// Idempotent: marking a completed lesson again changes nothing
		await prisma.lessonCompletion.createMany({
			data: [{ enrollmentId: enrollment.id, lessonId }],
			skipDuplicates: true,
		});
	else
		await prisma.lessonCompletion.deleteMany({
			where: { enrollmentId: enrollment.id, lessonId },
		});

	const [lessons, completions] = await Promise.all([
		prisma.lesson.findMany({
			where: { chapter: { courseId } },
			select: { id: true },
		}),
		prisma.lessonCompletion.findMany({
			where: { enrollmentId: enrollment.id },
			select: { lessonId: true },
		}),
	]);
	return {
		progress: progressOf(
			lessons.map((l) => l.id),
			completions.map((c) => c.lessonId),
		),
	};
};

// One review per student per course (rating 1-5, optional comment); sending it
// again updates it. Only students who own the course may rate it.
const saveReview = async (
	user: User,
	courseId: string,
	input: { rating: number; comment: string },
): Promise<ReviewResponse> => {
	const enrollment = await enrollmentOf(user.id, courseId);
	if (!enrollment)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only students who bought this course can rate it.",
		);
	const review = await prisma.$transaction(async (tx) => {
		const saved = await tx.review.upsert({
			where: { courseId_studentId: { courseId, studentId: user.id } },
			create: {
				courseId,
				studentId: user.id,
				studentName: user.name,
				rating: input.rating,
				comment: input.comment,
			},
			update: {
				studentName: user.name,
				rating: input.rating,
				comment: input.comment,
				date: new Date(),
			},
			include: { course: { select: { title: true } } },
		});
		await logActivity(
			tx,
			user,
			`Rated a course ${saved.rating}/5`,
			saved.course.title,
		);
		return saved;
	});
	return toReviewResponse(review);
};

export const LearnService = { getPlayer, recordWatch, setComplete, saveReview };
