// Pure helpers for the teacher area: submit validation, coupon/withdrawal
// response shapes. No database access, so they're unit tested directly.
import type { Coupon, Withdrawal } from "../../../generated/prisma/client.js";
import { toEmbedUrl } from "../../utils/youtube.js";
import type {
	CouponResponse,
	CouponState,
	WithdrawalResponse,
} from "./teacher.interface.js";
import type { CourseBody } from "./teacher.validation.js";
import { TITLE_MESSAGE } from "./teacher.validation.js";

// The fields validateForSubmit reads (a saved course has the same shape)
export type SubmittableCourse = Pick<
	CourseBody,
	"title" | "subject" | "description" | "outcomes" | "price" | "discountPrice"
> & {
	chapters: {
		title: string;
		lessons: { title: string; durationMin: number; videoUrl: string }[];
	}[];
};

// Full validation before a course goes to review (BACKEND_SPEC section 9),
// keyed like zod errors so the editor maps them: "chapters.1.lessons.2.videoUrl".
// Level, link formats and integer types are already enforced on every save.
export function validateForSubmit(
	c: SubmittableCourse,
): Record<string, string> {
	const e: Record<string, string> = {};
	if (c.title.trim().length < 5) e.title = TITLE_MESSAGE;
	if (!c.subject.trim()) e.subject = "Enter the subject, e.g. Physics.";
	if (c.description.trim().length < 20)
		e.description = "Describe the course in at least 20 characters.";
	if (!c.outcomes.some((o) => o.trim()))
		e.outcomes = "Add at least one learning outcome.";
	if (!Number.isInteger(c.price) || c.price < 100)
		e.price = "The price must be at least ৳100.";
	if (
		c.discountPrice != null &&
		(c.discountPrice <= 0 || c.discountPrice >= c.price)
	)
		e.discountPrice =
			"The discount price must be lower than the regular price.";
	if (!c.chapters.length) e.chapters = "Add at least one chapter.";
	c.chapters.forEach((ch, i) => {
		const at = `chapters.${i}`;
		if (!ch.title.trim()) e[`${at}.title`] = "Chapter title is required.";
		if (!ch.lessons.length)
			e[`${at}.lessons`] = "Add at least one lesson to this chapter.";
		ch.lessons.forEach((l, j) => {
			const lat = `${at}.lessons.${j}`;
			if (!l.title.trim()) e[`${lat}.title`] = "Lesson title is required.";
			if (!(Number.isInteger(l.durationMin) && l.durationMin > 0))
				e[`${lat}.durationMin`] = "Enter a duration in minutes.";
			if (!toEmbedUrl(l.videoUrl))
				e[`${lat}.videoUrl`] = "Enter a valid YouTube link or embed code.";
		});
	});
	return e;
}

// Expiry wins over the active switch, like the frontend's coupon list
export const couponState = (
	c: Pick<Coupon, "active" | "expiresAt">,
	now = Date.now(),
): CouponState =>
	c.expiresAt.getTime() < now ? "expired" : c.active ? "active" : "inactive";

export const toCouponResponse = (
	c: Coupon,
	now = Date.now(),
): CouponResponse => ({
	id: c.id,
	teacherId: c.teacherId,
	code: c.code,
	type: c.type,
	value: c.value,
	expiresAt: c.expiresAt.toISOString(),
	usageLimit: c.usageLimit,
	usedCount: c.usedCount,
	courseId: c.courseId,
	active: c.active,
	createdAt: c.createdAt.toISOString(),
	state: couponState(c, now),
});

export const toWithdrawalResponse = (w: Withdrawal): WithdrawalResponse => ({
	id: w.id,
	teacherId: w.teacherId,
	amount: w.amount,
	method: "bKash",
	accountNumber: w.accountNumber,
	status: w.status,
	requestedAt: w.requestedAt.toISOString(),
	processedAt: w.processedAt?.toISOString(),
	note: w.note ?? undefined,
});

// "৳12,500" for activity-log targets (section 12)
export const formatTaka = (amount: number) =>
	`৳${amount.toLocaleString("en-US")}`;
