import { z } from "zod";
import { COURSE_STATUSES, LEVELS } from "../../utils/constants.js";
import { paginationQuery } from "../../utils/pagination.js";

const id = z.string().min(1).max(64);
const optionalText = z.string().trim().max(100).optional();
const emptyIsUnset = z.literal("").transform(() => undefined);

// An enum filter where "" (the UI's "All") means no filter
const filter = <const T extends readonly [string, ...string[]]>(
	name: string,
	values: T,
) =>
	z
		.enum(values, { error: `${name} must be one of ${values.join(", ")}.` })
		.or(emptyIsUnset)
		.optional();

const USER_STATUSES = ["active", "banned"] as const;
const WITHDRAWAL_STATUSES = ["pending", "approved", "rejected"] as const;

const idParam = z.object({ params: z.object({ id }) });

const reason = (message: string) =>
	z
		.string({ error: message })
		.trim()
		.min(5, message)
		.max(1000, "Use at most 1000 characters.");

// ---------------------------------------------------------------- courses

const listCourses = z.object({
	query: z.object({
		status: filter("status", COURSE_STATUSES),
		level: filter("level", LEVELS),
		q: optionalText,
		...paginationQuery(10),
	}),
});

const rejectCourse = idParam.extend({
	body: z.object({ reason: reason("Give a reason for the rejection.") }),
});

const suspendCourse = idParam.extend({
	body: z.object({ reason: reason("Give a reason for the suspension.") }),
});

// Home page picks (courses and teachers)
const setFeatured = idParam.extend({
	body: z.object({
		featured: z.boolean({ error: "featured must be true or false." }),
	}),
});

// ---------------------------------------------------------------- people

const listTeachers = z.object({
	query: z.object({
		status: filter("status", USER_STATUSES),
		q: optionalText,
		...paginationQuery(10),
	}),
});

const listStudents = listTeachers;

const setUserStatus = idParam.extend({
	body: z.object({
		status: z.enum(USER_STATUSES, {
			error: "status must be active or banned.",
		}),
	}),
});

const setUserRole = idParam.extend({
	body: z.object({
		role: z.enum(["admin", "student"], {
			error: "role must be admin or student.",
		}),
	}),
});

// ---------------------------------------------------------------- money

const listRegistrationFees = z.object({
	query: z.object({ q: optionalText, ...paginationQuery(10) }),
});

const listTransactions = z.object({
	query: z.object({
		status: filter("status", ["completed", "refunded"]),
		method: filter("method", ["bKash", "Nagad", "Card"]),
		q: optionalText,
		...paginationQuery(10),
	}),
});

// No status = pending (spec 10.7); "" = every status
const listWithdrawals = z.object({
	query: z.object({
		status: z
			.enum(WITHDRAWAL_STATUSES, {
				error: `status must be one of ${WITHDRAWAL_STATUSES.join(", ")}.`,
			})
			.or(z.literal(""))
			.default("pending")
			.transform((v) => v || undefined),
		...paginationQuery(10),
	}),
});

const rejectWithdrawal = idParam.extend({
	body: z.object({ reason: reason("Give a reason for the rejection.") }),
});

// ---------------------------------------------------------------- activity

const listActivity = z.object({
	query: z.object({
		role: filter("role", ["student", "teacher", "admin", "system"]),
		q: optionalText,
		...paginationQuery(15),
	}),
});

export const AdminValidation = {
	idParam,
	listCourses,
	rejectCourse,
	suspendCourse,
	listTeachers,
	listStudents,
	setUserStatus,
	setFeatured,
	setUserRole,
	listRegistrationFees,
	listTransactions,
	listWithdrawals,
	rejectWithdrawal,
	listActivity,
};
