import { z } from "zod";
import { LEVELS } from "../../utils/constants.js";

export const PROGRESS_STATES = [
	"not-started",
	"in-progress",
	"completed",
] as const;

const optionalText = z.string().trim().max(100).optional();
const emptyIsUnset = z.literal("").transform(() => undefined);

const enrollments = z.object({
	query: z.object({
		q: optionalText,
		level: z
			.enum(LEVELS, { error: `level must be one of ${LEVELS.join(", ")}.` })
			.or(emptyIsUnset)
			.optional(),
		progress: z
			.enum(PROGRESS_STATES, {
				error: `progress must be one of ${PROGRESS_STATES.join(", ")}.`,
			})
			.or(emptyIsUnset)
			.optional(),
	}),
});

const savedLessons = z.object({
	query: z.object({ q: optionalText, courseId: optionalText }),
});

const saveLesson = z.object({
	body: z.object({
		courseId: z.string({ error: "Choose a course." }).min(1).max(64),
		lessonId: z.string({ error: "Choose a lesson." }).min(1).max(64),
	}),
});

const unsaveLesson = z.object({
	params: z.object({ lessonId: z.string().min(1).max(64) }),
});

export const StudentValidation = {
	enrollments,
	savedLessons,
	saveLesson,
	unsaveLesson,
};
