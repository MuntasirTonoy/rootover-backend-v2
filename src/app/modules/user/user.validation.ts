import { z } from "zod";
import { passwordSchema } from "../auth/auth.validation.js";

// An empty string clears an optional field (stored as null)
const clearable = <T extends z.ZodType<string>>(schema: T) =>
	z
		.union([z.literal(""), schema])
		.transform((value) => value || null)
		.optional();

// PATCH /api/me (BACKEND_SPEC section 9). Email and role are not editable;
// unknown keys (email, role, status, ...) are stripped, never applied.
// Changing the password also requires the current one, so a stolen token
// alone can't take over the account.
const updateMe = z.object({
	body: z
		.object({
			name: z
				.string()
				.trim()
				.min(2, "Enter your full name.")
				.max(80, "Use at most 80 characters.")
				.optional(),
			phone: clearable(
				z
					.string()
					.trim()
					.regex(/^01\d{9}$/, "Use an 11-digit number starting with 01."),
			),
			institution: clearable(
				z.string().trim().max(120, "Use at most 120 characters."),
			),
			gender: clearable(z.enum(["male", "female", "other"])),
			dateOfBirth: clearable(z.iso.date("Enter a valid date (YYYY-MM-DD).")),
			avatar: clearable(
				z
					.url({ protocol: /^https$/, error: "Enter a valid https image URL." })
					.max(2048),
			),
			password: passwordSchema.optional(),
			currentPassword: z.string().optional(),
		})
		.refine((body) => !body.password || body.currentPassword, {
			path: ["currentPassword"],
			message: "Enter your current password.",
		}),
});

export const UserValidation = { updateMe };
