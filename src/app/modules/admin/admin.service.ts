// The admin area (BACKEND_SPEC section 10.7) except course moderation
// (admin.courses.ts), teacher applications (application module) and video
// reports (part 11). Money figures always come from utils/finance.ts.
import httpStatus from "http-status";
import type { z } from "zod";
import type {
	ActivityLog,
	Prisma,
	User,
	WithdrawalStatus,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import { LEVELS } from "../../utils/constants.js";
import {
	loadAllTeacherFinances,
	loadTeacherFinance,
	saleRowSelect,
} from "../../utils/finance.queries.js";
import {
	monthlySeries,
	platformSummary,
	salesTotals,
} from "../../utils/finance.js";
import { pageMeta, paginateArray, skipTake } from "../../utils/pagination.js";
import {
	purchaseViewInclude,
	toPurchaseView,
} from "../purchase/purchase.utils.js";
import { toWithdrawalResponse } from "../teacher/teacher.utils.js";
import {
	toTeacherProfileResponse,
	toUserResponse,
} from "../user/user.utils.js";
import type {
	ActivityLogResponse,
	AdminFees,
	AdminOverview,
	AdminReports,
	AdminStudentRow,
	AdminTeacherRow,
	AdminTransactions,
	AdminWithdrawals,
} from "./admin.interface.js";
import type { AdminValidation } from "./admin.validation.js";

type ListSchemas = typeof AdminValidation;
type Query<
	K extends
		| "listTeachers"
		| "listStudents"
		| "listRegistrationFees"
		| "listTransactions"
		| "listWithdrawals"
		| "listActivity",
> = z.infer<ListSchemas[K]>["query"];

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

const toActivityResponse = (l: ActivityLog): ActivityLogResponse => ({
	id: l.id,
	actorName: l.actorName,
	actorRole: l.actorRole,
	action: l.action,
	target: l.target,
	at: l.at.toISOString(),
});

const teacherName = {
	select: { id: true, teacherCode: true, user: { select: { name: true } } },
} as const;

// ---------------------------------------------------------------- overview

const getOverview = async (): Promise<AdminOverview> => {
	const pendingApplicationWhere = {
		status: { in: ["pending_review", "under_verification"] },
	} satisfies Prisma.TeacherApplicationWhereInput;
	const [
		students,
		teachers,
		liveCourses,
		pendingCourseCount,
		purchases,
		fees,
		applicationCount,
		applications,
		courses,
		withdrawalCount,
		withdrawals,
		activity,
		open,
		awaitingApproval,
	] = await Promise.all([
		prisma.user.count({ where: { role: "student" } }),
		prisma.teacherProfile.count(),
		prisma.course.count({ where: { status: "approved" } }),
		prisma.course.count({ where: { status: "pending" } }),
		prisma.purchase.findMany({ select: saleRowSelect }),
		prisma.registrationFee.findMany({ select: { amount: true } }),
		prisma.teacherApplication.count({ where: pendingApplicationWhere }),
		prisma.teacherApplication.findMany({
			where: pendingApplicationWhere,
			select: { id: true, fullName: true, status: true, submittedAt: true },
			orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
			take: 5,
		}),
		prisma.course.findMany({
			where: { status: "pending" },
			select: { id: true, title: true, updatedAt: true, teacher: teacherName },
			orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
			take: 5,
		}),
		prisma.withdrawal.count({ where: { status: "pending" } }),
		prisma.withdrawal.findMany({
			where: { status: "pending" },
			select: {
				id: true,
				amount: true,
				requestedAt: true,
				teacher: teacherName,
			},
			orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
			take: 5,
		}),
		prisma.activityLog.findMany({
			orderBy: [{ at: "desc" }, { id: "asc" }],
			take: 8,
		}),
		prisma.videoReport.count({
			where: { status: { in: ["open", "fix_rejected"] } },
		}),
		prisma.videoReport.count({ where: { status: "fix_submitted" } }),
	]);
	const { totals, registrationFees } = platformSummary(purchases, fees);
	return {
		counts: {
			students,
			teachers,
			liveCourses,
			pendingCourses: pendingCourseCount,
			sales: totals.sales,
			refunded: totals.refundedCount,
			pendingApplications: applicationCount,
			pendingWithdrawals: withdrawalCount,
		},
		totals,
		registrationFees,
		monthly: monthlySeries(purchases),
		pendingApplications: applications.map((a) => ({
			...a,
			submittedAt: a.submittedAt.toISOString(),
		})),
		pendingCourses: courses.map((c) => ({
			id: c.id,
			title: c.title,
			teacher: { id: c.teacher.id, name: c.teacher.user.name },
			updatedAt: c.updatedAt.toISOString(),
		})),
		pendingWithdrawals: withdrawals.map((w) => ({
			id: w.id,
			amount: w.amount,
			teacher: { id: w.teacher.id, name: w.teacher.user.name },
			requestedAt: w.requestedAt.toISOString(),
		})),
		recentActivity: activity.map(toActivityResponse),
		reports: { open, awaitingApproval },
	};
};

// ---------------------------------------------------------------- people

// Rows carry balances (derived), so the list is built in memory; there are
// only as many rows as teachers
const listTeachers = async (query: Query<"listTeachers">) => {
	const [teachers, financeOf] = await Promise.all([
		prisma.teacherProfile.findMany({
			where: {
				user: query.status ? { status: query.status } : undefined,
				...(query.q
					? {
							OR: [
								{ teacherCode: contains(query.q) },
								{ user: { name: contains(query.q) } },
							],
						}
					: {}),
			},
			include: {
				user: {
					select: { name: true, email: true, avatar: true, status: true },
				},
				courses: { select: { status: true } },
			},
			orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
		}),
		loadAllTeacherFinances(prisma),
	]);
	const rows: AdminTeacherRow[] = teachers.map((t) => {
		const finance = financeOf(t.id);
		return {
			...toTeacherProfileResponse(t),
			name: t.user.name,
			email: t.user.email,
			avatar: t.user.avatar ?? undefined,
			status: t.user.status,
			liveCourses: t.courses.filter((c) => c.status === "approved").length,
			totalCourses: t.courses.length,
			gross: finance.gross,
			net: finance.teacherNet,
			withdrawable: finance.withdrawable,
		};
	});
	return paginateArray(rows, query.page, query.limit);
};

const listStudents = async (query: Query<"listStudents">) => {
	const where: Prisma.UserWhereInput = {
		role: "student",
		status: query.status,
		...(query.q
			? { OR: [{ name: contains(query.q) }, { email: contains(query.q) }] }
			: {}),
	};
	const [users, total] = await Promise.all([
		prisma.user.findMany({
			where,
			include: {
				_count: { select: { enrollments: true } },
				purchases: { select: saleRowSelect },
				applications: {
					select: { status: true },
					orderBy: { submittedAt: "desc" },
					take: 1,
				},
			},
			orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.user.count({ where }),
	]);
	const data: AdminStudentRow[] = users.map(
		({ _count, purchases, applications, ...user }) => ({
			...toUserResponse(user),
			enrolled: _count.enrollments,
			totalSpent: salesTotals(purchases).gross,
			applicationStatus: applications[0]?.status ?? null,
		}),
	);
	return { data, pagination: pageMeta(query.page, query.limit, total) };
};

// Banning takes effect on the user's next request (auth reloads the account)
// and hides a teacher's courses from the catalog (catalogWhere)
const setUserStatus = async (
	admin: User,
	id: string,
	status: "active" | "banned",
) => {
	if (id === admin.id)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			"You can't change your own account status.",
		);
	const user = await prisma.$transaction(async (tx) => {
		const target = await tx.user.findUnique({ where: { id } });
		if (!target) throw new AppError(httpStatus.NOT_FOUND, "User not found.");
		if (target.role === "admin")
			throw new AppError(
				httpStatus.UNPROCESSABLE_ENTITY,
				"Admin accounts can't be banned.",
			);
		if (target.status === status) return target;
		const updated = await tx.user.update({ where: { id }, data: { status } });
		await logActivity(
			tx,
			admin,
			status === "banned" ? "Banned user" : "Unbanned user",
			updated.name,
		);
		return updated;
	});
	return toUserResponse(user);
};

const listAdmins = async () => {
	const admins = await prisma.user.findMany({
		where: { role: "admin" },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
	return admins.map(toUserResponse);
};

// Makes a student an admin, or an admin a student again. Nobody changes their
// own role, so the caller stays an admin and there is always at least one.
// The changed account is signed out (its tokens carry the old role).
const setUserRole = async (
	admin: User,
	id: string,
	role: "admin" | "student",
) => {
	const refuse = (message: string) =>
		new AppError(httpStatus.UNPROCESSABLE_ENTITY, message);
	if (id === admin.id) throw refuse("You can't change your own role.");
	const user = await prisma.$transaction(async (tx) => {
		const target = await tx.user.findUnique({ where: { id } });
		if (!target) throw new AppError(httpStatus.NOT_FOUND, "User not found.");
		if (target.role === role) return target;
		if (role === "admin") {
			if (target.role !== "student")
				throw refuse("Only student accounts can be made admins.");
			if (target.status === "banned") throw refuse("Unban this user first.");
			if (!target.emailVerifiedAt)
				throw refuse("This user hasn't verified their email yet.");
		}
		const updated = await tx.user.update({
			where: { id },
			data: { role, tokenVersion: { increment: 1 } },
		});
		await logActivity(
			tx,
			admin,
			role === "admin" ? "Made user an admin" : "Removed admin role",
			updated.name,
		);
		return updated;
	});
	return toUserResponse(user);
};

// ---------------------------------------------------------------- money

const listRegistrationFees = async (
	query: Query<"listRegistrationFees">,
): Promise<AdminFees> => {
	const where: Prisma.RegistrationFeeWhereInput = query.q
		? {
				OR: [
					{ trxId: contains(query.q) },
					{ application: { fullName: contains(query.q) } },
				],
			}
		: {};
	const [fees, total, all, awaitingPayment] = await Promise.all([
		prisma.registrationFee.findMany({
			where,
			include: {
				application: { select: { fullName: true, status: true } },
				user: { select: { email: true } },
			},
			orderBy: [{ paidAt: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.registrationFee.count({ where }),
		prisma.registrationFee.aggregate({ _sum: { amount: true }, _count: true }),
		prisma.teacherApplication.count({ where: { status: "payment_required" } }),
	]);
	return {
		data: fees.map(({ application, user, ...f }) => ({
			...f,
			paidAt: f.paidAt.toISOString(),
			applicant: { fullName: application.fullName, email: user.email },
			applicationStatus: application.status,
		})),
		pagination: pageMeta(query.page, query.limit, total),
		totals: {
			collected: all._sum.amount ?? 0,
			count: all._count,
			awaitingPayment,
		},
	};
};

const transactionWhere = (
	query: Query<"listTransactions">,
): Prisma.PurchaseWhereInput => ({
	status: query.status,
	method: query.method,
	...(query.q
		? {
				OR: [
					{ trxId: contains(query.q) },
					{ course: { title: contains(query.q) } },
					{ student: { name: contains(query.q) } },
					{ teacher: { user: { name: contains(query.q) } } },
				],
			}
		: {}),
});

const listTransactions = async (
	query: Query<"listTransactions">,
): Promise<AdminTransactions> => {
	const where = transactionWhere(query);
	const [rows, total, filtered] = await Promise.all([
		prisma.purchase.findMany({
			where,
			include: purchaseViewInclude,
			orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.purchase.count({ where }),
		prisma.purchase.findMany({ where, select: saleRowSelect }),
	]);
	return {
		data: rows.map(toPurchaseView),
		pagination: pageMeta(query.page, query.limit, total),
		totals: salesTotals(filtered),
	};
};

const getTransaction = async (id: string) => {
	const row = await prisma.purchase.findUnique({
		where: { id },
		include: purchaseViewInclude,
	});
	if (!row) throw new AppError(httpStatus.NOT_FOUND, "Transaction not found.");
	return toPurchaseView(row);
};

const WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
	"pending",
	"approved",
	"rejected",
];

// Pending first, then newest. Sums cover every withdrawal, whatever the filter.
const listWithdrawals = async (
	query: Query<"listWithdrawals">,
): Promise<AdminWithdrawals> => {
	const [rows, groups, financeOf] = await Promise.all([
		prisma.withdrawal.findMany({
			where: { status: query.status },
			include: { teacher: teacherName },
			orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
		}),
		prisma.withdrawal.groupBy({
			by: ["status"],
			_sum: { amount: true },
			_count: true,
		}),
		loadAllTeacherFinances(prisma),
	]);
	const pendingFirst = [
		...rows.filter((w) => w.status === "pending"),
		...rows.filter((w) => w.status !== "pending"),
	];
	const list = pendingFirst.map(({ teacher, ...w }) => ({
		...toWithdrawalResponse(w),
		teacher: {
			id: teacher.id,
			name: teacher.user.name,
			teacherCode: teacher.teacherCode,
		},
		withdrawable: financeOf(teacher.id).withdrawable,
	}));
	const sums = Object.fromEntries(
		WITHDRAWAL_STATUSES.map((s) => {
			const g = groups.find((x) => x.status === s);
			return [s, { amount: g?._sum.amount ?? 0, count: g?._count ?? 0 }];
		}),
	) as AdminWithdrawals["sums"];
	return { ...paginateArray(list, query.page, query.limit), sums };
};

// Only from pending, as a guarded update (two admins can't both process it).
// The amount was already reserved from the balance when it was requested, so
// approving is the simulated payout and rejecting returns it to withdrawable.
const processWithdrawal = async (
	admin: User,
	id: string,
	status: "approved" | "rejected",
	reason?: string,
) => {
	const withdrawal = await prisma.$transaction(async (tx) => {
		const { count } = await tx.withdrawal.updateMany({
			where: { id, status: "pending" },
			data: { status, processedAt: new Date(), note: reason ?? null },
		});
		if (count === 0) {
			const exists = await tx.withdrawal.count({ where: { id } });
			throw exists
				? new AppError(
						httpStatus.UNPROCESSABLE_ENTITY,
						"Only pending withdrawals can be processed.",
					)
				: new AppError(httpStatus.NOT_FOUND, "Withdrawal not found.");
		}
		const updated = await tx.withdrawal.findUniqueOrThrow({
			where: { id },
			include: { teacher: teacherName },
		});
		await logActivity(
			tx,
			admin,
			status === "approved" ? "Approved withdrawal" : "Rejected withdrawal",
			updated.teacher.user.name,
		);
		return updated;
	});
	const { teacher, ...w } = withdrawal;
	return {
		...toWithdrawalResponse(w),
		teacher: {
			id: teacher.id,
			name: teacher.user.name,
			teacherCode: teacher.teacherCode,
		},
		withdrawable: (await loadTeacherFinance(prisma, teacher.id)).withdrawable,
	};
};

// ---------------------------------------------------------------- reports

const getReports = async (): Promise<AdminReports> => {
	const [purchases, fees, teachers, courses, financeOf] = await Promise.all([
		prisma.purchase.findMany({
			select: { ...saleRowSelect, courseId: true },
		}),
		prisma.registrationFee.findMany({ select: { amount: true } }),
		prisma.teacherProfile.findMany({
			select: { id: true, user: { select: { name: true } } },
			orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
		}),
		prisma.course.findMany({ select: { id: true, level: true } }),
		loadAllTeacherFinances(prisma),
	]);
	const levelOf = new Map(courses.map((c) => [c.id, c.level]));
	return {
		...platformSummary(purchases, fees),
		monthly: monthlySeries(purchases),
		byTeacher: teachers.map((t) => ({
			id: t.id,
			name: t.user.name,
			...financeOf(t.id),
		})),
		byLevel: LEVELS.map((level) => ({
			level,
			...salesTotals(
				purchases.filter((p) => levelOf.get(p.courseId) === level),
			),
		})),
	};
};

// ---------------------------------------------------------------- activity

const listActivity = async (query: Query<"listActivity">) => {
	const where: Prisma.ActivityLogWhereInput = {
		actorRole: query.role,
		...(query.q
			? {
					OR: [
						{ actorName: contains(query.q) },
						{ action: contains(query.q) },
						{ target: contains(query.q) },
					],
				}
			: {}),
	};
	const [rows, total] = await Promise.all([
		prisma.activityLog.findMany({
			where,
			orderBy: [{ at: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.activityLog.count({ where }),
	]);
	return {
		data: rows.map(toActivityResponse),
		pagination: pageMeta(query.page, query.limit, total),
	};
};

export const AdminService = {
	getOverview,
	listTeachers,
	listStudents,
	setUserStatus,
	listAdmins,
	setUserRole,
	listRegistrationFees,
	listTransactions,
	getTransaction,
	listWithdrawals,
	approveWithdrawal: (admin: User, id: string) =>
		processWithdrawal(admin, id, "approved"),
	rejectWithdrawal: (admin: User, id: string, reason: string) =>
		processWithdrawal(admin, id, "rejected", reason),
	getReports,
	listActivity,
};
