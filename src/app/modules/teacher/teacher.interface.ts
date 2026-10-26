import type {
	CouponType,
	CourseStatus,
	Level,
	WithdrawalStatus,
} from "../../../generated/prisma/client.js";
import type { MonthPoint, TeacherFinance } from "../../utils/finance.js";
import type { Paginated } from "../../utils/pagination.js";
import type { Progress, Rating } from "../course/course.interface.js";
import type {
	EnrollmentResponse,
	PurchaseView,
} from "../purchase/purchase.utils.js";

// Response shapes for /api/teacher (BACKEND_SPEC sections 10.6 and 11)

export type CouponState = "active" | "inactive" | "expired";

export interface CouponResponse {
	id: string;
	teacherId: string;
	code: string;
	type: CouponType;
	value: number;
	expiresAt: string;
	usageLimit: number;
	usedCount: number;
	courseId: string | null;
	active: boolean;
	createdAt: string;
	state: CouponState;
}

export interface WithdrawalResponse {
	id: string;
	teacherId: string;
	amount: number;
	method: "bKash";
	accountNumber: string;
	status: WithdrawalStatus;
	requestedAt: string;
	processedAt?: string;
	note?: string;
}

export interface TeacherCourseRow {
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
	students: number;
	net: number;
	rating: Rating;
	chapters: number;
	lessons: number;
	updatedAt: string;
}

export interface CoursePerformance {
	course: { id: string; title: string };
	status: CourseStatus;
	students: number;
	gross: number;
	net: number;
	rating: Rating;
}

export interface RecentEnrollment {
	purchaseId: string;
	student: { id: string; name: string; avatar?: string };
	course: { id: string; title: string };
	amountPaid: number;
	teacherNet: number;
	createdAt: string;
}

export interface TeacherDashboard {
	counts: { total: number; approved: number; pending: number; draft: number };
	students: number;
	finance: TeacherFinance;
	monthly: MonthPoint[];
	coursePerformance: CoursePerformance[];
	recentEnrollments: RecentEnrollment[];
	reports: { needsFix: number; awaitingAdmin: number };
}

export interface TeacherStudentRow {
	enrollment: EnrollmentResponse;
	student: { id: string; name: string; email: string; avatar?: string };
	course: { id: string; title: string };
	progress: Progress;
	amountPaid: number;
}

export interface TeacherStudents extends Paginated<TeacherStudentRow> {
	stats: {
		enrollments: number;
		uniqueStudents: number;
		averageProgress: number;
	};
}

export interface TeacherEarnings {
	finance: TeacherFinance;
	monthly: MonthPoint[];
	transactions: Paginated<PurchaseView>;
}
