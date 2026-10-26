// Course moderation (BACKEND_SPEC sections 7 and 10.7): every course in any
// status, and the admin transitions pending -> approved | rejected,
// approved -> suspended, suspended -> approved (reinstate).
import httpStatus from "http-status";
import type { z } from "zod";
import type {
	CourseStatus,
	Prisma,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import { saleRowSelect } from "../../utils/finance.queries.js";
import { salesTotals } from "../../utils/finance.js";
import { paginateArray } from "../../utils/pagination.js";
import { coursePrice } from "../../utils/pricing.js";
import { courseFullInclude } from "../course/course.queries.js";
import { toCourseResponse } from "../course/course.utils.js";
import type { AdminCourseDetail, AdminCourseRow } from "./admin.interface.js";
import type { AdminValidation } from "./admin.validation.js";

type ListQuery = z.infer<typeof AdminValidation.listCourses>["query"];

const NOT_FOUND = "Course not found.";

const teacherSelect = {
	id: true,
	teacherCode: true,
	user: { select: { name: true, status: true } },
} as const;

// GET /api/admin/courses: pending first, then most recently updated. Sorted in
// memory because "pending first" isn't a column order.
const listCourses = async (query: ListQuery) => {
	const rows = await prisma.course.findMany({
		where: {
			status: query.status,
			level: query.level,
			...(query.q
				? {
						OR: [
							{ title: { contains: query.q, mode: "insensitive" } },
							{
								teacher: {
									user: { name: { contains: query.q, mode: "insensitive" } },
								},
							},
						],
					}
				: {}),
		},
		include: {
			teacher: { select: teacherSelect },
			chapters: { select: { lessons: { select: { durationMin: true } } } },
			_count: { select: { enrollments: true } },
		},
		orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
	});
	const pendingFirst = [
		...rows.filter((c) => c.status === "pending"),
		...rows.filter((c) => c.status !== "pending"),
	];
	const list: AdminCourseRow[] = pendingFirst.map((c) => {
		const lessons = c.chapters.flatMap((ch) => ch.lessons);
		return {
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
			teacher: {
				id: c.teacher.id,
				name: c.teacher.user.name,
				teacherCode: c.teacher.teacherCode,
			},
			students: c._count.enrollments,
			chapterCount: c.chapters.length,
			lessonCount: lessons.length,
			durationMin: lessons.reduce((s, l) => s + l.durationMin, 0),
			featured: c.featured,
			createdAt: c.createdAt.toISOString(),
			updatedAt: c.updatedAt.toISOString(),
		};
	});
	return paginateArray(list, query.page, query.limit);
};

// The full course with raw lesson links (admins can watch everything)
const getCourse = async (id: string): Promise<AdminCourseDetail> => {
	const row = await prisma.course.findUnique({
		where: { id },
		include: {
			...courseFullInclude,
			teacher: { select: teacherSelect },
			purchases: { select: saleRowSelect },
		},
	});
	if (!row) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	const totals = salesTotals(row.purchases);
	return {
		...toCourseResponse(row),
		teacher: {
			id: row.teacher.id,
			name: row.teacher.user.name,
			teacherCode: row.teacher.teacherCode,
			status: row.teacher.user.status,
		},
		effectivePrice: coursePrice(row),
		sales: totals.sales,
		gross: totals.gross,
	};
};

const ACTIONS = {
	approve: {
		from: ["pending", "suspended"],
		to: "approved",
		log: "Approved course",
	},
	reject: { from: ["pending"], to: "rejected", log: "Rejected course" },
	suspend: { from: ["approved"], to: "suspended", log: "Suspended course" },
} satisfies Record<
	string,
	{ from: CourseStatus[]; to: CourseStatus; log: string }
>;

// A guarded update on the allowed from-statuses, so two admins acting at once
// can't both apply. Approving clears the old note; reject/suspend set it.
const setStatus = async (
	admin: User,
	id: string,
	action: keyof typeof ACTIONS,
	reason?: string,
) => {
	const { from, to, log } = ACTIONS[action];
	const row = await prisma.$transaction(async (tx) => {
		const data: Prisma.CourseUpdateManyMutationInput = {
			status: to,
			statusNote: reason ?? null,
		};
		const { count } = await tx.course.updateMany({
			where: { id, status: { in: from } },
			data,
		});
		if (count === 0) {
			const exists = await tx.course.count({ where: { id } });
			throw exists
				? new AppError(
						httpStatus.UNPROCESSABLE_ENTITY,
						"This course can't be updated from its current status.",
					)
				: new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
		}
		const course = await tx.course.findUniqueOrThrow({
			where: { id },
			include: courseFullInclude,
		});
		await logActivity(tx, admin, log, course.title);
		return course;
	});
	return toCourseResponse(row);
};

export const AdminCourseService = {
	listCourses,
	getCourse,
	approve: (admin: User, id: string) => setStatus(admin, id, "approve"),
	reject: (admin: User, id: string, reason: string) =>
		setStatus(admin, id, "reject", reason),
	suspend: (admin: User, id: string, reason: string) =>
		setStatus(admin, id, "suspend", reason),
};
