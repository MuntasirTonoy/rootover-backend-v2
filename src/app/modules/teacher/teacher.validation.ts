import { z } from "zod";
import { COURSE_STATUSES, LEVELS } from "../../utils/constants.js";
import { paginationQuery } from "../../utils/pagination.js";
import { MIN_WITHDRAWAL } from "../../utils/pricing.js";

export const TITLE_MESSAGE =
	"Give the course a title of at least 5 characters.";
export const NOTE_LINK_MESSAGE = "Enter a valid https link for the notes.";
const BKASH_MESSAGE = "Enter an 11-digit bKash number starting with 01.";

const id = z.string().min(1).max(64);
const optionalText = z.string().trim().max(100).optional();
const emptyIsUnset = z.literal("").transform(() => undefined);
const emptyIsNull = z.literal("").transform(() => null);

// https links only: lesson notes and thumbnails end up in href/src attributes
const httpsUrl = (message: string) =>
	z.url({ protocol: /^https$/, error: message }).max(2048, message);

// ---------------------------------------------------------------- courses

// The editor's whole course (BACKEND_SPEC section 10.6, "Course body").
// Saving a draft only needs a title; the completeness rules of section 9 run
// on submit (see validateForSubmit in teacher.utils.ts). Formats (https links,
// integers) are always enforced.
const lesson = z.object({
	id: id.optional(),
	title: z.string().trim().max(200).default(""),
	durationMin: z
		.number({ error: "Enter a duration in minutes." })
		.int("Enter a duration in minutes.")
		.min(0, "Enter a duration in minutes.")
		.max(10_000, "Enter a duration in minutes."),
	// Raw input; may be a pasted <iframe>, normalised on save
	videoUrl: z.string().trim().max(4096).default(""),
	noteLink: httpsUrl(NOTE_LINK_MESSAGE)
		.or(emptyIsNull)
		.nullable()
		.default(null),
	isPreview: z.boolean().default(false),
});

const chapter = z.object({
	id: id.optional(),
	title: z.string().trim().max(200).default(""),
	lessons: z.array(lesson).max(200).default([]),
});

export const courseBody = z.object({
	level: z.enum(LEVELS, { error: "Choose a level." }),
	subject: z.string().trim().max(100).default(""),
	title: z
		.string({ error: TITLE_MESSAGE })
		.trim()
		.min(5, TITLE_MESSAGE)
		.max(150),
	description: z.string().trim().max(5000).default(""),
	thumbnail: httpsUrl("Enter a valid https image link.")
		.or(emptyIsNull)
		.nullable()
		.default(null),
	// Empty outcomes are dropped
	outcomes: z
		.array(z.string().trim().max(300))
		.max(30)
		.default([])
		.transform((list) => list.filter(Boolean)),
	price: z
		.number({ error: "The price must be at least ৳100." })
		.int("Use a whole number of taka.")
		.min(0, "The price must be at least ৳100.")
		.max(1_000_000, "The price is too high."),
	// 0 means "no discount"
	discountPrice: z
		.number()
		.int("Use a whole number of taka.")
		.min(0)
		.max(1_000_000)
		.nullable()
		.default(null)
		.transform((v) => v || null),
	chapters: z.array(chapter).max(100).default([]),
});

export type CourseBody = z.infer<typeof courseBody>;

const listCourses = z.object({
	query: z.object({
		q: optionalText,
		status: z
			.enum(COURSE_STATUSES, {
				error: `status must be one of ${COURSE_STATUSES.join(", ")}.`,
			})
			.or(emptyIsUnset)
			.optional(),
	}),
});

const courseId = z.object({ params: z.object({ id }) });
const createCourse = z.object({ body: courseBody });
const updateCourse = z.object({ params: z.object({ id }), body: courseBody });

// ---------------------------------------------------------------- profile

const updateProfile = z.object({
	body: z.object({
		// An empty headline falls back to the default, like the frontend form
		headline: z
			.string()
			.trim()
			.max(120, "Keep the headline under 120 characters.")
			.transform((v) => v || "Teacher on Root Over")
			.optional(),
		bio: z
			.string()
			.trim()
			.max(2000, "Keep the bio under 2000 characters.")
			.optional(),
		institution: z.string().trim().max(150).optional(),
		experienceYears: z
			.number({ error: "Enter your years of experience." })
			.int("Enter your years of experience.")
			.min(0, "Enter your years of experience.")
			.max(70, "Enter your years of experience.")
			.optional(),
		qualifications: z
			.array(z.string().trim().max(150))
			.max(20)
			.transform((list) => list.filter(Boolean))
			.optional(),
	}),
});

// ---------------------------------------------------------------- students / earnings

const students = z.object({
	query: z.object({
		courseId: id.or(emptyIsUnset).optional(),
		q: optionalText,
		...paginationQuery(10),
	}),
});

const earnings = z.object({
	query: z.object({
		courseId: id.or(emptyIsUnset).optional(),
		...paginationQuery(10),
	}),
});

// ---------------------------------------------------------------- coupons

const CODE_MESSAGE = "Use 4–15 letters or numbers.";

const couponBody = z
	.object({
		code: z
			.string({ error: CODE_MESSAGE })
			.trim()
			.toUpperCase()
			.regex(/^[A-Z0-9]{4,15}$/, CODE_MESSAGE),
		type: z.enum(["percent", "fixed"], { error: "Choose a discount type." }),
		value: z
			.number({ error: "Enter a discount greater than 0." })
			.int("Enter a discount greater than 0.")
			.min(1, "Enter a discount greater than 0.")
			.max(1_000_000, "Enter a discount greater than 0."),
		usageLimit: z
			.number({ error: "Allow at least one use." })
			.int("Allow at least one use.")
			.min(1, "Allow at least one use.")
			.max(1_000_000, "Allow at least one use."),
		// The UI sends the end of the chosen day in Asia/Dhaka
		expiresAt: z.iso
			.datetime({ offset: true, error: "Choose an expiry date." })
			.transform((v) => new Date(v)),
		// null / "" = every course of this teacher
		courseId: id.or(emptyIsNull).nullable().default(null),
		active: z.boolean().default(true),
	})
	.refine((c) => c.type !== "percent" || c.value <= 90, {
		path: ["value"],
		message: "Percentage discounts are capped at 90%.",
	});

export type CouponBody = z.infer<typeof couponBody>;

const createCoupon = z.object({ body: couponBody });
const updateCoupon = z.object({ params: z.object({ id }), body: couponBody });
const couponId = z.object({ params: z.object({ id }) });
const setCouponActive = z.object({
	params: z.object({ id }),
	body: z.object({
		active: z.boolean({ error: "active must be true or false." }),
	}),
});

// ---------------------------------------------------------------- withdrawals

const MIN_MESSAGE = `The minimum withdrawal is ৳${MIN_WITHDRAWAL}.`;

const requestWithdrawal = z.object({
	body: z.object({
		amount: z
			.number({ error: MIN_MESSAGE })
			.int("Enter a whole amount.")
			.min(MIN_WITHDRAWAL, MIN_MESSAGE)
			.max(100_000_000, "The amount is more than your withdrawable balance."),
		accountNumber: z
			.string({ error: BKASH_MESSAGE })
			.trim()
			.regex(/^01\d{9}$/, BKASH_MESSAGE),
	}),
});

// ---------------------------------------------------------------- editor helpers

const videoLink = z.object({
	query: z.object({ url: z.string().max(4096).default("") }),
});

const pricePreview = z.object({
	query: z.object({
		price: z.coerce.number().int().min(0).max(1_000_000).default(0),
		// 0 / empty = no discount
		discountPrice: z.coerce
			.number()
			.int()
			.min(0)
			.max(1_000_000)
			.optional()
			.transform((v) => v || null),
	}),
});

export const TeacherValidation = {
	videoLink,
	pricePreview,
	listCourses,
	courseId,
	createCourse,
	updateCourse,
	updateProfile,
	students,
	earnings,
	createCoupon,
	updateCoupon,
	couponId,
	setCouponActive,
	requestWithdrawal,
};
