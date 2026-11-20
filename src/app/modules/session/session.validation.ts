import { z } from "zod";

const sessionId = z.object({
	params: z.object({ id: z.string().min(1).max(64) }),
});

// DELETE /api/me/sessions?others=true keeps this device signed in
const revokeAll = z.object({
	query: z.object({
		others: z
			.enum(["true", "false"], { error: "others must be true or false." })
			.transform((v) => v === "true")
			.optional(),
	}),
});

export const SessionValidation = { sessionId, revokeAll };
