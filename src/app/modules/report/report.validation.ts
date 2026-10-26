import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const REPORT_REASONS = [
	"VIDEO_ISSUE",
	"AUDIO_ISSUE",
	"WRONG_CONTENT",
	"INAPPROPRIATE_CONTENT",
	"BROKEN_LINK",
	"OTHER",
] as const;
const REPORT_STATUSES = [
	"open",
	"fix_submitted",
	"fix_rejected",
	"resolved",
] as const;

const id = z.string().min(1).max(64);
const emptyIsUnset = z.literal("").transform(() => undefined);

const DESCRIBE = "Please describe the problem.";
const FIX_NOTE = "Describe what you fixed.";
const REJECT_REASON = "Explain why the fix was rejected.";

const create = z.object({
	params: z.object({ courseId: id, lessonId: id }),
	body: z
		.object({
			reason: z.enum(REPORT_REASONS, {
				error: "Choose what's wrong with this video.",
			}),
			description: z
				.string()
				.trim()
				.max(1000, "Use at most 1000 characters.")
				.optional()
				.transform((v) => v || undefined),
		})
		.refine((b) => b.reason !== "OTHER" || b.description, {
			path: ["description"],
			message: DESCRIBE,
		}),
});

// status: one of the statuses, "action" (what this role has to act on) or "" (all)
const list = z.object({
	query: z.object({
		status: z
			.enum([...REPORT_STATUSES, "action"], {
				error: `status must be action or one of ${REPORT_STATUSES.join(", ")}.`,
			})
			.or(emptyIsUnset)
			.optional(),
		courseId: id.or(emptyIsUnset).optional(),
		teacherId: id.or(emptyIsUnset).optional(),
		// Course, lesson or reporter name
		q: z.string().trim().max(100).optional(),
		...paginationQuery(10),
	}),
});

const note = (message: string) =>
	z.string({ error: message }).trim().min(5, message).max(1000, message);

const submitFix = z.object({
	params: z.object({ id }),
	body: z.object({ note: note(FIX_NOTE) }),
});

const approveFix = z.object({
	params: z.object({ id }),
	body: z
		.object({
			note: z
				.string()
				.trim()
				.max(1000, "Use at most 1000 characters.")
				.optional()
				.transform((v) => v || undefined),
		})
		.default({ note: undefined }),
});

const rejectFix = z.object({
	params: z.object({ id }),
	body: z.object({ reason: note(REJECT_REASON) }),
});

export type ReportListQuery = z.infer<typeof list>["query"];

export const ReportValidation = {
	create,
	list,
	submitFix,
	approveFix,
	rejectFix,
};
