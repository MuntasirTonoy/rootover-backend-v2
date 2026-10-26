// Response shapes for purchases and enrollments (BACKEND_SPEC section 11),
// shared by checkout, the student pages, teacher earnings and admin views.
import type {
	Enrollment,
	PaymentMethod,
	Prisma,
	Purchase,
	PurchaseStatus,
} from "../../../generated/prisma/client.js";

export interface PurchaseResponse {
	id: string;
	studentId: string;
	courseId: string;
	teacherId: string;
	listPrice: number;
	coursePrice: number;
	couponCode?: string;
	couponDiscount: number;
	amountPaid: number;
	commission: number;
	teacherNet: number;
	method: PaymentMethod;
	trxId: string;
	status: PurchaseStatus;
	createdAt: string;
}

export interface PurchaseView extends PurchaseResponse {
	course: { id: string; title: string };
	student: { id: string; name: string; email: string };
	teacher: { id: string; name: string };
}

export interface EnrollmentResponse {
	id: string;
	studentId: string;
	courseId: string;
	purchaseId: string;
	enrolledAt: string;
	completedLessonIds: string[];
	lastLessonId?: string;
	lastWatchedAt?: string;
}

export const toPurchaseResponse = (p: Purchase): PurchaseResponse => ({
	id: p.id,
	studentId: p.studentId,
	courseId: p.courseId,
	teacherId: p.teacherId,
	listPrice: p.listPrice,
	coursePrice: p.coursePrice,
	couponCode: p.couponCode ?? undefined,
	couponDiscount: p.couponDiscount,
	amountPaid: p.amountPaid,
	commission: p.commission,
	teacherNet: p.teacherNet,
	method: p.method,
	trxId: p.trxId,
	status: p.status,
	createdAt: p.createdAt.toISOString(),
});

export const purchaseViewInclude = {
	course: { select: { id: true, title: true } },
	student: { select: { id: true, name: true, email: true } },
	teacher: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.PurchaseInclude;

export type PurchaseViewRow = Prisma.PurchaseGetPayload<{
	include: typeof purchaseViewInclude;
}>;

export const toPurchaseView = (p: PurchaseViewRow): PurchaseView => ({
	...toPurchaseResponse(p),
	course: p.course,
	student: p.student,
	teacher: { id: p.teacher.id, name: p.teacher.user.name },
});

export const toEnrollmentResponse = (
	e: Enrollment,
	completedLessonIds: string[],
): EnrollmentResponse => ({
	id: e.id,
	studentId: e.studentId,
	courseId: e.courseId,
	purchaseId: e.purchaseId,
	enrolledAt: e.enrolledAt.toISOString(),
	completedLessonIds,
	lastLessonId: e.lastLessonId ?? undefined,
	lastWatchedAt: e.lastWatchedAt?.toISOString(),
});
