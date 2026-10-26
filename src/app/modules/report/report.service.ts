// Video reports (BACKEND_SPEC section 14): a student reports a lesson video
// they can watch -> the course's teacher submits a fix -> an admin approves it
// (resolved) or rejects it (back to the teacher), until approved.
//
//   open | fix_rejected --(teacher: submit fix)--> fix_submitted
//   fix_submitted --(admin: approve)--> resolved | --(admin: reject)--> fix_rejected
//
// Every transition is a guarded update on the allowed from-statuses (so two
// requests can't both apply), appends a VideoReportEvent and an ActivityLog row.
import httpStatus from "http-status";
import type {
	Prisma,
	ReportEventType,
	ReportReason,
	ReportStatus,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import { paginateArray } from "../../utils/pagination.js";
import { CourseService } from "../course/course.service.js";
import { teacherOf } from "../teacher/teacher.queries.js";
import type { ReportListQuery } from "./report.validation.js";

type Tx = Prisma.TransactionClient;
type Mode = "teacher" | "admin";

const NOT_FOUND = "Report not found.";
const BAD_TRANSITION = "This report can't be updated from its current status.";
const DUPLICATE =
	"You've already reported this video. We'll update you when it's fixed.";

// What each side has to act on, in priority order (spec: teachers see
// fix_rejected and open first, admins fix_submitted first)
const NEEDS_ACTION: Record<Mode, ReportStatus[]> = {
	teacher: ["fix_rejected", "open"],
	admin: ["fix_submitted"],
};

export const reportViewInclude = {
	course: { select: { id: true, title: true } },
	lesson: {
		select: {
			id: true,
			title: true,
			videoUrl: true,
			chapter: { select: { id: true, title: true } },
		},
	},
	teacher: { select: { id: true, user: { select: { name: true } } } },
	reporter: { select: { id: true, name: true } },
	events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.VideoReportInclude;

type ReportRow = Prisma.VideoReportGetPayload<{
	include: typeof reportViewInclude;
}>;

// VideoReportView. The full lesson link is only ever sent to the teacher, an
// admin or the reporter (the only callers); the reporter appears by name only.
export const toReportView = (r: ReportRow) => ({
	id: r.id,
	reason: r.reason,
	description: r.description ?? undefined,
	status: r.status,
	teacherNote: r.teacherNote ?? undefined,
	adminNote: r.adminNote ?? undefined,
	createdAt: r.createdAt.toISOString(),
	updatedAt: r.updatedAt.toISOString(),
	fixSubmittedAt: r.fixSubmittedAt?.toISOString(),
	resolvedAt: r.resolvedAt?.toISOString(),
	course: r.course,
	chapter: r.lesson.chapter,
	lesson: {
		id: r.lesson.id,
		title: r.lesson.title,
		videoUrl: r.lesson.videoUrl,
	},
	teacher: { id: r.teacher.id, name: r.teacher.user.name },
	reporter: r.reporter,
	events: r.events.map((e) => ({
		id: e.id,
		type: e.type,
		actorName: e.actorName,
		actorRole: e.actorRole,
		note: e.note ?? undefined,
		at: e.at.toISOString(),
	})),
});

const loadView = async (db: Tx | typeof prisma, id: string) =>
	toReportView(
		await db.videoReport.findUniqueOrThrow({
			where: { id },
			include: reportViewInclude,
		}),
	);

const logTarget = (r: {
	course: { title: string };
	lesson: { title: string };
}) => `${r.course.title} · ${r.lesson.title}`;

const addEvent = (
	tx: Tx,
	reportId: string,
	actor: User,
	type: ReportEventType,
	note?: string,
) =>
	tx.videoReportEvent.create({
		data: {
			reportId,
			actorId: actor.id,
			actorName: actor.name,
			actorRole: actor.role,
			type,
			note: note ?? null,
		},
	});

// ------------------------------------------------------------ student

// POST /api/learn/:courseId/lessons/:lessonId/reports
const create = async (
	user: User,
	courseId: string,
	lessonId: string,
	input: { reason: ReportReason; description?: string },
) => {
	if (user.role !== "student")
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only students can report videos.",
		);
	// The same visibility and locking as the player (404 for a hidden course)
	const course = await CourseService.getCourse(courseId, user);
	const lesson = course.chapters
		.flatMap((ch) => ch.lessons)
		.find((l) => l.id === lessonId);
	if (!lesson) throw new AppError(httpStatus.NOT_FOUND, "Lesson not found.");
	if (!lesson.canWatch)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only report lessons you can watch.",
		);

	const id = await prisma.$transaction(async (tx) => {
		// One active report per student per lesson, even with two requests at once
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report:${user.id}:${lessonId}`}))`;
		const active = await tx.videoReport.count({
			where: { reporterId: user.id, lessonId, status: { not: "resolved" } },
		});
		if (active) throw new AppError(httpStatus.CONFLICT, DUPLICATE);
		const report = await tx.videoReport.create({
			data: {
				lessonId,
				// Copied so dashboards filter fast and history survives course edits
				courseId,
				teacherId: course.teacher.id,
				reporterId: user.id,
				reason: input.reason,
				description: input.description ?? null,
			},
		});
		await addEvent(tx, report.id, user, "reported", input.description);
		await logActivity(
			tx,
			user,
			"Reported a video",
			logTarget({ course, lesson }),
		);
		return report.id;
	});
	return loadView(prisma, id);
};

// GET /api/me/video-reports: the student's own reports, newest first
const mine = async (user: User) => {
	const rows = await prisma.videoReport.findMany({
		where: { reporterId: user.id },
		include: reportViewInclude,
		orderBy: [{ createdAt: "desc" }, { id: "asc" }],
	});
	return rows.map(toReportView);
};

// ------------------------------------------------------------ boards

const countsOf = (statuses: ReportStatus[]) => ({
	needsFix: statuses.filter((s) => s === "open" || s === "fix_rejected").length,
	awaitingApproval: statuses.filter((s) => s === "fix_submitted").length,
	resolved: statuses.filter((s) => s === "resolved").length,
});

// Sorted by priority for this role, then newest update; counts cover every
// report this role can see (not just the filtered page)
const board = async (
	mode: Mode,
	scope: Prisma.VideoReportWhereInput,
	query: ReportListQuery,
) => {
	const priority = NEEDS_ACTION[mode];
	const q = query.q
		? { contains: query.q, mode: "insensitive" as const }
		: undefined;
	const [rows, statuses] = await Promise.all([
		prisma.videoReport.findMany({
			where: {
				...scope,
				courseId: query.courseId,
				...(mode === "admin" ? { teacherId: query.teacherId } : {}),
				status:
					query.status === "action"
						? { in: priority }
						: (query.status as ReportStatus | undefined),
				...(q
					? {
							OR: [
								{ course: { title: q } },
								{ lesson: { title: q } },
								{ reporter: { name: q } },
							],
						}
					: {}),
			},
			include: reportViewInclude,
			orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
		}),
		prisma.videoReport.findMany({ where: scope, select: { status: true } }),
	]);
	const rank = (s: ReportStatus) => {
		const i = priority.indexOf(s);
		return i === -1 ? priority.length : i;
	};
	// Stable sort keeps the newest-first order within a priority
	const sorted = [...rows].sort((a, b) => rank(a.status) - rank(b.status));
	return {
		...paginateArray(sorted.map(toReportView), query.page, query.limit),
		counts: countsOf(statuses.map((s) => s.status)),
	};
};

// GET /api/teacher/reports: only this teacher's courses
const teacherList = async (user: User, query: ReportListQuery) => {
	const teacher = await teacherOf(user);
	return board("teacher", { teacherId: teacher.id }, query);
};

// GET /api/admin/video-reports
const adminList = (query: ReportListQuery) => board("admin", {}, query);

// ------------------------------------------------------------ transitions

const transition = async (
	actor: User,
	where: Prisma.VideoReportWhereInput & { id: string },
	from: ReportStatus[],
	data: Prisma.VideoReportUpdateManyMutationInput,
	event: { type: ReportEventType; note?: string; log: string },
) =>
	prisma.$transaction(async (tx) => {
		const { count } = await tx.videoReport.updateMany({
			where: { ...where, status: { in: from } },
			data,
		});
		if (count === 0) {
			const exists = await tx.videoReport.count({ where });
			throw exists
				? new AppError(httpStatus.UNPROCESSABLE_ENTITY, BAD_TRANSITION)
				: new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
		}
		await addEvent(tx, where.id, actor, event.type, event.note);
		const view = await loadView(tx, where.id);
		await logActivity(tx, actor, event.log, logTarget(view));
		return view;
	});

// The course's teacher only (another teacher's report is a 404)
const submitFix = async (user: User, id: string, note: string) => {
	const teacher = await teacherOf(user);
	return transition(
		user,
		{ id, teacherId: teacher.id },
		["open", "fix_rejected"],
		{ status: "fix_submitted", teacherNote: note, fixSubmittedAt: new Date() },
		{ type: "fix_submitted", note, log: "Submitted a video fix" },
	);
};

const approveFix = (admin: User, id: string, note?: string) =>
	transition(
		admin,
		{ id },
		["fix_submitted"],
		{ status: "resolved", resolvedAt: new Date(), adminNote: note ?? null },
		{ type: "fix_approved", note, log: "Approved a video fix" },
	);

const rejectFix = (admin: User, id: string, reason: string) =>
	transition(
		admin,
		{ id },
		["fix_submitted"],
		{ status: "fix_rejected", adminNote: reason },
		{ type: "fix_rejected", note: reason, log: "Rejected a video fix" },
	);

export const ReportService = {
	create,
	mine,
	teacherList,
	adminList,
	submitFix,
	approveFix,
	rejectFix,
};
