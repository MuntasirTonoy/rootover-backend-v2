import { z } from "zod";

// Messages match the frontend (BACKEND_SPEC section 9). The `error` on each
// base type covers a missing or non-string field, which .min() never sees.
export const passwordSchema = z
	.string({ error: "Use at least 6 characters." })
	.min(6, "Use at least 6 characters.")
	// bcrypt only uses the first 72 bytes
	.max(72, "Use at most 72 characters.");

// Trim first: z.email() checks the format before any later .trim()
const emailSchema = z
	.string({ error: "Enter a valid email address." })
	.trim()
	.max(254, "Enter a valid email address.")
	.pipe(z.email("Enter a valid email address."));

const codeSchema = z
	.string({ error: "Enter the 6-digit code." })
	.trim()
	.regex(/^\d{6}$/, "Enter the 6-digit code.");

const register = z.object({
	body: z.object({
		name: z
			.string({ error: "Enter your full name." })
			.trim()
			.min(2, "Enter your full name.")
			.max(80, "Use at most 80 characters."),
		email: emailSchema,
		password: passwordSchema,
	}),
});

// Only shape checks here; wrong credentials are reported by the local strategy
const login = z.object({
	body: z.object({
		email: z
			.string({ error: "Enter your email address." })
			.trim()
			.min(1, "Enter your email address."),
		password: z
			.string({ error: "Enter your password." })
			.min(1, "Enter your password."),
	}),
});

const verifyEmail = z.object({
	body: z.object({ email: emailSchema, code: codeSchema }),
});

const resendVerification = z.object({ body: z.object({ email: emailSchema }) });

const forgotPassword = z.object({ body: z.object({ email: emailSchema }) });

const resetPassword = z.object({
	body: z.object({
		email: emailSchema,
		code: codeSchema,
		password: passwordSchema,
	}),
});

// The ID token (a JWT) that Google Identity Services hands the browser
const google = z.object({
	body: z.object({
		credential: z
			.string({ error: "Google sign-in failed. Please try again." })
			.min(20, "Google sign-in failed. Please try again.")
			.max(4096, "Google sign-in failed. Please try again."),
	}),
});

export const AuthValidation = {
	google,
	register,
	login,
	verifyEmail,
	resendVerification,
	forgotPassword,
	resetPassword,
};
