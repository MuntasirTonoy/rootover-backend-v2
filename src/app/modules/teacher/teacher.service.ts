// The signed-in teacher's profile, dashboard, students, earnings and
// withdrawals (BACKEND_SPEC section 10.6). Every query is scoped by the
// teacher id from teacherOf(), so a teacher only ever sees their own data.
import httpStatus from "http-status";
import type { z } from "zod";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import {
	loadTeacherFinance,
	saleRowSelect,
} from "../../utils/finance.queries.js";
import {
	monthlySeries,
	salesTotals,
	teacherFinance,
} from "../../utils/finance.js";
import { pageMeta, paginateArray, skipTake } from "../../utils/pagination.js";
import { toApplicationResponse } from "../application/application.utils.js";
import { teacherPublicInclude } from "../course/course.queries.js";
import {
	progressOf,
	ratingOf,
	toTeacherPublic,
} from "../course/course.utils.js";
import {
	purchaseViewInclude,
	toEnrollmentResponse,
	toPurchaseView,
} from "../purchase/purchase.utils.js";
import { toTeacherProfileResponse } from "../user/user.utils.js";
import type {
	TeacherDashboard,
	TeacherEarnings,
	TeacherStudents,
} from "./teacher.interface.js";
import { teacherOf } from "./teacher.queries.js";
import { formatTaka, toWithdrawalResponse } from "./teacher.utils.js";
import type { TeacherValidation } from "./teacher.validation.js";

type ProfileInput = z.infer<typeof TeacherValidation.updateProfile>["body"];
type StudentsQuery = z.infer<typeof TeacherValidation.students>["query"];
type EarningsQuery = z.infer<typeof TeacherValidation.earnings>["query"];
type WithdrawalInput = z.infer<
	typeof TeacherValidation.requestWithdrawal
>["body"];

const OVER_BALANCE = "The amount is more than your withdrawable balance.";

// The application that made this user a teacher, else their latest one
const applicationOf = async (teacherId: string, userId: string) =>
	(await prisma.teacherApplication.findUnique({ where: { teacherId } })) ??
	(await prisma.teacherApplication.findFirst({
		where: { userId },
		orderBy: { submittedAt: "desc" },
	}));

// GET /api/teacher/me: identity numbers are masked in teacher-facing views
const getMe = async (user: User) => {
	const { id } = await teacherOf(user);
	const [teacher, application] = await Promise.all([
		prisma.teacherProfile.findUniqueOrThrow({
			where: { id },
			include: teacherPublicInclude,
		}),
		applicationOf(id, user.id),
	]);
	return {
		teacher: toTeacherPublic(teacher),
		application: application
			? toApplicationResponse(application, { mask: true })
			: null,
	};
};

const updateMe = async (user: User, input: ProfileInput) => {
	const { id } = await teacherOf(user);
	const teacher = await prisma.teacherProfile.update({
		where: { id },
		data: input,
	});
	return toTeacherProfileResponse(teacher);
};

const getDashboard = async (user: User): Promise<TeacherDashboard> => {
	const { id: teacherId } = await teacherOf(user);
	const [courses, purchases, withdrawals, recent, needsFix, awaitingAdmin] =
		await Promise.all([
			prisma.course.findMany({
				where: { teacherId },
				select: {
					id: true,
					title: true,
					status: true,
					ratingSum: true,
					ratingCount: true,
					_count: { select: { enrollments: true } },
				},
				orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
			}),
			prisma.purchase.findMany({
				where: { teacherId },
				select: { ...saleRowSelect, courseId: true, studentId: true },
			}),
			prisma.withdrawal.findMany({
				where: { teacherId },
				select: { status: true, amount: true },
			}),
			prisma.purchase.findMany({
				where: { teacherId, status: "completed" },
				include: {
					student: { select: { id: true, name: true, avatar: true } },
					course: { select: { id: true, title: true } },
				},
				orderBy: [{ createdAt: "desc" }, { id: "asc" }],
				take: 6,
			}),
			prisma.videoReport.count({
				where: { teacherId, status: { in: ["open", "fix_rejected"] } },
			}),
			prisma.videoReport.count({
				where: { teacherId, status: "fix_submitted" },
			}),
		]);

	const count = (s: (typeof courses)[number]["status"]) =>
		courses.filter((c) => c.status === s).length;
	const salesOf = (courseId: string) =>
		salesTotals(purchases.filter((p) => p.courseId === courseId));

	return {
		counts: {
			total: courses.length,
			approved: count("approved"),
			pending: count("pending"),
			draft: count("draft"),
		},
		// Unique buyers over completed sales
		students: new Set(
			purchases.filter((p) => p.status === "completed").map((p) => p.studentId),
		).size,
		finance: teacherFinance(purchases, withdrawals),
		monthly: monthlySeries(purchases),
		// Drafts have never been reviewed, so they're left out (like the frontend)
		coursePerformance: courses
			.filter((c) => c.status !== "draft")
			.map((c) => {
				const totals = salesOf(c.id);
				return {
					course: { id: c.id, title: c.title },
					status: c.status,
					students: c._count.enrollments,
					gross: totals.gross,
					net: totals.teacherNet,
					rating: ratingOf(c),
				};
			}),
		recentEnrollments: recent.map((p) => ({
			purchaseId: p.id,
			student: {
				id: p.student.id,
				name: p.student.name,
				avatar: p.student.avatar ?? undefined,
			},
			course: p.course,
			amountPaid: p.amountPaid,
			teacherNet: p.teacherNet,
			createdAt: p.createdAt.toISOString(),
		})),
		reports: { needsFix, awaitingAdmin },
	};
};

// Everyone enrolled in the teacher's courses, newest first. Stats cover the
// filtered rows (not just the page), like the frontend.
const listStudents = async (
	user: User,
	query: StudentsQuery,
): Promise<TeacherStudents> => {
	const { id: teacherId } = await teacherOf(user);
	const enrollments = await prisma.enrollment.findMany({
		where: {
			course: { teacherId },
			courseId: query.courseId,
			student: query.q
				? {
						OR: [
							{ name: { contains: query.q, mode: "insensitive" } },
							{ email: { contains: query.q, mode: "insensitive" } },
						],
					}
				: undefined,
		},
		include: {
			student: { select: { id: true, name: true, email: true, avatar: true } },
			course: {
				select: {
					id: true,
					title: true,
					chapters: { select: { lessons: { select: { id: true } } } },
				},
			},
			completions: { select: { lessonId: true } },
			purchase: { select: { amountPaid: true } },
		},
		orderBy: [{ enrolledAt: "desc" }, { id: "asc" }],
	});

	const rows = enrollments.map((e) => {
		const { student, course, completions, purchase, ...enrollment } = e;
		const completedIds = completions.map((c) => c.lessonId);
		const lessonIds = course.chapters.flatMap((ch) =>
			ch.lessons.map((l) => l.id),
		);
		return {
			enrollment: toEnrollmentResponse(enrollment, completedIds),
			student: {
				id: student.id,
				name: student.name,
				email: student.email,
				avatar: student.avatar ?? undefined,
			},
			course: { id: course.id, title: course.title },
			progress: progressOf(lessonIds, completedIds),
			amountPaid: purchase.amountPaid,
		};
	});

	return {
		...paginateArray(rows, query.page, query.limit),
		stats: {
			enrollments: rows.length,
			uniqueStudents: new Set(rows.map((r) => r.student.id)).size,
			averageProgress: rows.length
				? Math.round(
						rows.reduce((s, r) => s + r.progress.percent, 0) / rows.length,
					)
				: 0,
		},
	};
};

// Finance and the chart cover all sales; courseId only filters the table
const getEarnings = async (
	user: User,
	query: EarningsQuery,
): Promise<TeacherEarnings> => {
	const { id: teacherId } = await teacherOf(user);
	const where = { teacherId, courseId: query.courseId };
	const [sales, withdrawals, transactions, total] = await Promise.all([
		prisma.purchase.findMany({ where: { teacherId }, select: saleRowSelect }),
		prisma.withdrawal.findMany({
			where: { teacherId },
			select: { status: true, amount: true },
		}),
		prisma.purchase.findMany({
			where,
			include: purchaseViewInclude,
			orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.purchase.count({ where }),
	]);
	return {
		finance: teacherFinance(sales, withdrawals),
		monthly: monthlySeries(sales),
		transactions: {
			data: transactions.map(toPurchaseView),
			pagination: pageMeta(query.page, query.limit, total),
		},
	};
};

// defaultAccount pre-fills the form with the bKash number from the application
const listWithdrawals = async (user: User) => {
	const { id: teacherId } = await teacherOf(user);
	const [finance, application, withdrawals] = await Promise.all([
		loadTeacherFinance(prisma, teacherId),
		prisma.teacherApplication.findFirst({
			where: { userId: user.id },
			orderBy: { submittedAt: "desc" },
			select: { bkashNumber: true },
		}),
		prisma.withdrawal.findMany({
			where: { teacherId },
			orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
		}),
	]);
	return {
		finance,
		defaultAccount: application?.bkashNumber ?? "",
		withdrawals: withdrawals.map(toWithdrawalResponse),
	};
};

// The balance is re-checked inside the transaction under a per-teacher lock,
// so two requests at once can never withdraw more than is available
const requestWithdrawal = async (user: User, input: WithdrawalInput) => {
	const { id: teacherId } = await teacherOf(user);
	const withdrawal = await prisma.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`withdrawal:${teacherId}`}))`;
		const { withdrawable } = await loadTeacherFinance(tx, teacherId);
		if (input.amount > withdrawable)
			throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, OVER_BALANCE, {
				amount: OVER_BALANCE,
			});
		const created = await tx.withdrawal.create({
			data: {
				teacherId,
				amount: input.amount,
				method: "bKash",
				accountNumber: input.accountNumber,
			},
		});
		await logActivity(
			tx,
			user,
			"Requested a withdrawal",
			formatTaka(input.amount),
		);
		return created;
	});
	return toWithdrawalResponse(withdrawal);
};

export const TeacherService = {
	getMe,
	updateMe,
	getDashboard,
	listStudents,
	getEarnings,
	listWithdrawals,
	requestWithdrawal,
};
