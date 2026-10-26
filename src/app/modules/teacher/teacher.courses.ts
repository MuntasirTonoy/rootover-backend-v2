// The teacher's own courses: list, create, edit (whole course at once),
// submit for approval and delete (BACKEND_SPEC sections 7 and 10.6).
import httpStatus from "http-status";
import type {
	CourseStatus,
	Prisma,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma, { table } from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import { saleRowSelect } from "../../utils/finance.queries.js";
import { salesTotals } from "../../utils/finance.js";
import { coursePrice } from "../../utils/pricing.js";
import { toEmbedUrl } from "../../utils/youtube.js";
import { courseFullInclude } from "../course/course.queries.js";
import { ownPublicUpload } from "../upload/upload.service.js";
import { ratingOf, toCourseResponse } from "../course/course.utils.js";
import type { TeacherCourseRow } from "./teacher.interface.js";
import { LONG_TX, teacherOf } from "./teacher.queries.js";
import { validateForSubmit } from "./teacher.utils.js";
import type { CourseBody } from "./teacher.validation.js";

type Tx = Prisma.TransactionClient;

const NOT_FOUND = "Course not found.";
const SUBMITTABLE: CourseStatus[] = ["draft", "rejected"];
// Courses students can see (or soon will): saving them keeps every lesson
// complete, so a live course can't be saved with a broken video link
const GUARDED: CourseStatus[] = ["pending", "approved", "suspended"];

const fail = (fields: Record<string, string>) => {
	if (Object.keys(fields).length)
		throw new AppError(
			httpStatus.BAD_REQUEST,
			Object.values(fields)[0],
			fields,
		);
};

// A new thumbnail must be the teacher's own upload (an unchanged one is kept)
const checkThumbnail = async (
	user: User,
	thumbnail: string | null,
	current: string | null = null,
) => {
	if (!thumbnail || thumbnail === current) return;
	if (!(await ownPublicUpload(user.id, "thumbnail", thumbnail)))
		fail({ thumbnail: "Upload the thumbnail again." });
};

const courseFields = (body: CourseBody) => ({
	level: body.level,
	subject: body.subject,
	title: body.title,
	description: body.description,
	thumbnail: body.thumbnail,
	outcomes: body.outcomes,
	price: body.price,
	discountPrice: body.discountPrice,
});

// Locks the course row for the rest of the transaction, so concurrent saves,
// submits and deletes of the same course run one after another. 404 unless it
// belongs to this teacher.
const lockOwnCourse = async (tx: Tx, teacherId: string, id: string) => {
	const rows = await tx.$queryRaw<{ id: string }[]>`
		SELECT id FROM ${table("Course")} WHERE id = ${id} AND "teacherId" = ${teacherId} FOR UPDATE`;
	if (!rows.length) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	return tx.course.findUniqueOrThrow({ where: { id } });
};

// Writes chapters and lessons from the body, keeping ids stable: completions,
// saved lessons and video reports point at lesson ids. Ids that already belong
// to this course are updated in place (a lesson may move between chapters),
// everything else is created with a fresh id, rows missing from the body are
// deleted, and positions follow array order. Unchanged rows aren't written.
async function writeCurriculum(
	tx: Tx,
	courseId: string,
	chapters: CourseBody["chapters"],
) {
	const existing = await tx.chapter.findMany({
		where: { courseId },
		include: { lessons: true },
	});
	const oldChapters = new Map(existing.map((ch) => [ch.id, ch]));
	const oldLessons = new Map(
		existing.flatMap((ch) => ch.lessons).map((l) => [l.id, l]),
	);
	const keptChapters = new Set<string>();
	const keptLessons = new Set<string>();

	for (const [position, ch] of chapters.entries()) {
		let chapterId: string;
		const old = ch.id ? oldChapters.get(ch.id) : undefined;
		if (old && !keptChapters.has(old.id)) {
			chapterId = old.id;
			if (old.title !== ch.title || old.position !== position)
				await tx.chapter.update({
					where: { id: chapterId },
					data: { title: ch.title, position },
				});
		} else {
			({ id: chapterId } = await tx.chapter.create({
				data: { courseId, title: ch.title, position },
				select: { id: true },
			}));
		}
		keptChapters.add(chapterId);

		const created: Prisma.LessonCreateManyInput[] = [];
		for (const [lessonPosition, l] of ch.lessons.entries()) {
			const data = {
				chapterId,
				title: l.title,
				durationMin: l.durationMin,
				// Always the embed form when the link is valid; invalid drafts keep the raw text
				videoUrl: toEmbedUrl(l.videoUrl) ?? l.videoUrl,
				noteLink: l.noteLink,
				isPreview: l.isPreview,
				position: lessonPosition,
			};
			const prev = l.id ? oldLessons.get(l.id) : undefined;
			if (prev && !keptLessons.has(prev.id)) {
				keptLessons.add(prev.id);
				const changed = (Object.keys(data) as (keyof typeof data)[]).some(
					(k) => prev[k] !== data[k],
				);
				if (changed) await tx.lesson.update({ where: { id: prev.id }, data });
			} else created.push(data);
		}
		if (created.length) await tx.lesson.createMany({ data: created });
	}

	// Lessons first: a kept lesson may have moved out of a chapter deleted below
	const dropLessons = [...oldLessons.keys()].filter(
		(id) => !keptLessons.has(id),
	);
	if (dropLessons.length)
		await tx.lesson.deleteMany({ where: { id: { in: dropLessons } } });
	const dropChapters = [...oldChapters.keys()].filter(
		(id) => !keptChapters.has(id),
	);
	if (dropChapters.length)
		await tx.chapter.deleteMany({ where: { id: { in: dropChapters } } });
}

const loadFull = (tx: Tx | typeof prisma, id: string) =>
	tx.course.findUniqueOrThrow({ where: { id }, include: courseFullInclude });

// GET /api/teacher/courses: most recently updated first
const listCourses = async (
	user: User,
	query: { q?: string; status?: CourseStatus },
): Promise<TeacherCourseRow[]> => {
	const teacher = await teacherOf(user);
	const rows = await prisma.course.findMany({
		where: {
			teacherId: teacher.id,
			status: query.status,
			title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
		},
		include: {
			chapters: { select: { _count: { select: { lessons: true } } } },
			reviews: { select: { rating: true } },
			purchases: { select: saleRowSelect },
			_count: { select: { enrollments: true } },
		},
		orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
	});
	return rows.map((c) => ({
		id: c.id,
		title: c.title,
		level: c.level,
		subject: c.subject,
		thumbnail: c.thumbnail ?? undefined,
		status: c.status,
		statusNote: c.statusNote ?? undefined,
		price: c.price,
		discountPrice: c.discountPrice ?? undefined,
		effectivePrice: coursePrice(c),
		students: c._count.enrollments,
		net: salesTotals(c.purchases).teacherNet,
		rating: ratingOf(c.reviews),
		chapters: c.chapters.length,
		lessons: c.chapters.reduce((s, ch) => s + ch._count.lessons, 0),
		updatedAt: c.updatedAt.toISOString(),
	}));
};

// POST /api/teacher/courses: always starts as a draft; client ids are ignored
const createCourse = async (user: User, body: CourseBody) => {
	const teacher = await teacherOf(user);
	await checkThumbnail(user, body.thumbnail);
	const row = await prisma.$transaction(async (tx) => {
		const course = await tx.course.create({
			data: { ...courseFields(body), teacherId: teacher.id, status: "draft" },
		});
		await writeCurriculum(tx, course.id, body.chapters);
		await logActivity(tx, user, "Created a course draft", course.title);
		return loadFull(tx, course.id);
	}, LONG_TX);
	return toCourseResponse(row);
};

const getCourse = async (user: User, id: string) => {
	const teacher = await teacherOf(user);
	const row = await prisma.course.findFirst({
		where: { id, teacherId: teacher.id },
		include: courseFullInclude,
	});
	if (!row) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	return toCourseResponse(row);
};

// PUT /api/teacher/courses/:id: saving never changes the status (section 7)
const updateCourse = async (user: User, id: string, body: CourseBody) => {
	const teacher = await teacherOf(user);
	const row = await prisma.$transaction(async (tx) => {
		const course = await lockOwnCourse(tx, teacher.id, id);
		await checkThumbnail(user, body.thumbnail, course.thumbnail);
		if (GUARDED.includes(course.status)) fail(validateForSubmit(body));
		await tx.course.update({ where: { id }, data: courseFields(body) });
		await writeCurriculum(tx, id, body.chapters);
		return loadFull(tx, id);
	}, LONG_TX);
	return toCourseResponse(row);
};

// draft/rejected -> pending, after the full validation of the SAVED course.
// Clears the admin's previous rejection note.
const submitCourse = async (user: User, id: string) => {
	const teacher = await teacherOf(user);
	const row = await prisma.$transaction(async (tx) => {
		const course = await lockOwnCourse(tx, teacher.id, id);
		if (!SUBMITTABLE.includes(course.status))
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Only draft or rejected courses can be submitted for approval.",
			);
		fail(validateForSubmit(await loadFull(tx, id)));
		await tx.course.update({
			where: { id },
			data: { status: "pending", statusNote: null },
		});
		await logActivity(
			tx,
			user,
			"Submitted a course for approval",
			course.title,
		);
		return loadFull(tx, id);
	});
	return toCourseResponse(row);
};

// Only draft/rejected courses that nobody has bought
const deleteCourse = async (user: User, id: string) => {
	const teacher = await teacherOf(user);
	await prisma.$transaction(async (tx) => {
		const course = await lockOwnCourse(tx, teacher.id, id);
		if (!SUBMITTABLE.includes(course.status))
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Only draft or rejected courses can be deleted.",
			);
		const [enrollments, purchases] = await Promise.all([
			tx.enrollment.count({ where: { courseId: id } }),
			tx.purchase.count({ where: { courseId: id } }),
		]);
		if (enrollments || purchases)
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Courses with students can't be deleted.",
			);
		await tx.course.delete({ where: { id } });
		await logActivity(tx, user, "Deleted a course", course.title);
	});
};

export const TeacherCourseService = {
	listCourses,
	createCourse,
	getCourse,
	updateCourse,
	submitCourse,
	deleteCourse,
};
