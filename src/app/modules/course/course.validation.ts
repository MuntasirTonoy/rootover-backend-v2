import { z } from "zod";
import { LEVELS } from "../../utils/constants.js";
import { paginationQuery } from "../../utils/pagination.js";

export const PRICE_RANGES = ["under1000", "1000-2000", "over2000"] as const;
export const COURSE_SORTS = [
	"popular",
	"rating",
	"newest",
	"price-asc",
	"price-desc",
] as const;

const optionalText = z.string().trim().max(100).optional();

// GET /api/courses (BACKEND_SPEC section 10.2). Empty values mean "no filter".
const listCourses = z.object({
	query: z.object({
		q: optionalText,
		level: z
			.enum(LEVELS, { error: `level must be one of ${LEVELS.join(", ")}.` })
			.or(z.literal("").transform(() => undefined))
			.optional(),
		subject: optionalText,
		teacherId: optionalText,
		price: z
			.enum(PRICE_RANGES, {
				error: `price must be one of ${PRICE_RANGES.join(", ")}.`,
			})
			.or(z.literal("").transform(() => undefined))
			.optional(),
		sort: z
			.enum(COURSE_SORTS, {
				error: `sort must be one of ${COURSE_SORTS.join(", ")}.`,
			})
			.default("popular"),
		featured: z
			.enum(["true", "false"], { error: "featured must be true or false." })
			.transform((v) => v === "true")
			.optional(),
		...paginationQuery(12),
	}),
});

const courseId = z.object({
	params: z.object({ id: z.string().min(1).max(64) }),
});

export const CourseValidation = { listCourses, courseId };
