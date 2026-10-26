import type {
	ApplicationStatus,
	CourseStatus,
	Level,
	PaymentMethod,
	UserStatus,
	WithdrawalStatus,
} from "../../../generated/prisma/client.js";
import type {
	MonthPoint,
	SalesTotals,
	TeacherFinance,
} from "../../utils/finance.js";
import type { Paginated } from "../../utils/pagination.js";
import type { CourseResponse } from "../course/course.interface.js";
import type { PurchaseView } from "../purchase/purchase.utils.js";
import type { WithdrawalResponse } from "../teacher/teacher.interface.js";
import type {
	TeacherProfileResponse,
	UserResponse,
} from "../user/user.interface.js";

// Response shapes for /api/admin (BACKEND_SPEC sections 10.7 and 11)

export interface ActivityLogResponse {
	id: string;
	actorName: string;
	actorRole: "student" | "teacher" | "admin" | "system";
	action: string;
	target: string;
	at: string;
}

export interface AdminOverview {
	counts: {
		students: number;
		teachers: number;
		liveCourses: number;
		pendingCourses: number;
		sales: number;
		refunded: number;
		// Totals behind the ≤5 lists below (not in the spec; the headings show them)
		pendingApplications: number;
		pendingWithdrawals: number;
	};
	totals: SalesTotals;
	registrationFees: { total: number; count: number };
	monthly: MonthPoint[];
	pendingApplications: {
		id: string;
		fullName: string;
		status: ApplicationStatus;
		submittedAt: string;
	}[];
	pendingCourses: {
		id: string;
		title: string;
		teacher: { id: string; name: string };
		updatedAt: string;
	}[];
	pendingWithdrawals: {
		id: string;
		amount: number;
		teacher: { id: string; name: string };
		requestedAt: string;
	}[];
	recentActivity: ActivityLogResponse[];
	reports: { open: number; awaitingApproval: number };
}

export interface AdminCourseRow {
	id: string;
	title: string;
	level: Level;
	subject: string;
	thumbnail?: string;
	status: CourseStatus;
	statusNote?: string;
	price: number;
	discountPrice?: number;
	effectivePrice: number;
	teacher: { id: string; name: string; teacherCode: string };
	students: number;
	chapterCount: number;
	lessonCount: number;
	durationMin: number;
	createdAt: string;
	updatedAt: string;
}

export interface AdminCourseDetail extends CourseResponse {
	teacher: {
		id: string;
		name: string;
		teacherCode: string;
		status: UserStatus;
	};
	effectivePrice: number;
	sales: number;
	gross: number;
}

export interface AdminTeacherRow extends TeacherProfileResponse {
	name: string;
	email: string;
	avatar?: string;
	status: UserStatus;
	liveCourses: number;
	totalCourses: number;
	gross: number;
	net: number;
	withdrawable: number;
}

export interface AdminStudentRow extends UserResponse {
	enrolled: number;
	totalSpent: number;
	applicationStatus: ApplicationStatus | null;
}

export interface AdminFeeRow {
	id: string;
	applicationId: string;
	userId: string;
	amount: number;
	method: PaymentMethod;
	payerNumber: string;
	trxId: string;
	paidAt: string;
	applicant: { fullName: string; email: string };
	applicationStatus: ApplicationStatus;
}

export interface AdminFees extends Paginated<AdminFeeRow> {
	totals: { collected: number; count: number; awaitingPayment: number };
}

export interface AdminTransactions extends Paginated<PurchaseView> {
	// Over every filtered row, not just this page
	totals: SalesTotals;
}

export interface AdminWithdrawalRow extends WithdrawalResponse {
	teacher: { id: string; name: string; teacherCode: string };
	// The teacher's balance right now
	withdrawable: number;
}

export interface AdminWithdrawals extends Paginated<AdminWithdrawalRow> {
	sums: Record<WithdrawalStatus, { amount: number; count: number }>;
}

export interface AdminReports {
	totals: SalesTotals;
	registrationFees: { total: number; count: number };
	platformRevenue: number;
	monthly: MonthPoint[];
	byTeacher: (TeacherFinance & { id: string; name: string })[];
	byLevel: (SalesTotals & { level: Level })[];
}
