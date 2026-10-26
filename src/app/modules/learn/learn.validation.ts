import { z } from "zod";

const id = z.string().min(1).max(64);

const player = z.object({ params: z.object({ courseId: id }) });

const lesson = z.object({ params: z.object({ courseId: id, lessonId: id }) });

const complete = z.object({
	params: z.object({ courseId: id, lessonId: id }),
	body: z.object({ done: z.boolean({ error: "done must be true or false." }) }),
});

export const LearnValidation = { player, lesson, complete };
