import { z } from "zod";

const listTeachers = z.object({
	query: z.object({
		q: z.string().trim().max(100).optional(),
		featured: z
			.enum(["true", "false"], { error: "featured must be true or false." })
			.transform((v) => v === "true")
			.optional(),
	}),
});

const teacherId = z.object({
	params: z.object({ id: z.string().min(1).max(64) }),
});

export const TeachersValidation = { listTeachers, teacherId };
