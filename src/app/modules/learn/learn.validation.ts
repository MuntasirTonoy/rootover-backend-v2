import { z } from "zod";

const id = z.string().min(1).max(64);

const player = z.object({ params: z.object({ courseId: id }) });

const lesson = z.object({ params: z.object({ courseId: id, lessonId: id }) });

const complete = z.object({
	params: z.object({ courseId: id, lessonId: id }),
	body: z.object({ done: z.boolean({ error: "done must be true or false." }) }),
});

const RATING_MESSAGE = "Choose a rating from 1 to 5 stars.";

const rating = z.object({
	params: z.object({ courseId: id }),
	body: z.object({
		rating: z
			.number({ error: RATING_MESSAGE })
			.int(RATING_MESSAGE)
			.min(1, RATING_MESSAGE)
			.max(5, RATING_MESSAGE),
	}),
});

export const LearnValidation = { player, lesson, complete, rating };
