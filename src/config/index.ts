import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Load .env file
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

// bKash Tokenized Checkout base URLs (BKASH_BASE_URL picks one)
export const BKASH_URLS = {
	sandbox: "https://tokenized.sandbox.bka.sh/v1.2.0-beta",
	live: "https://tokenized.pay.bka.sh/v1.2.0-beta",
} as const;

// Rejects empty values and the "replace_me" placeholders copied from .env.example
const required = (name: string) =>
	z
		.string()
		.min(1, `${name} is required`)
		.refine(
			(value) => !value.includes("replace_me"),
			`${name} still has the placeholder value from .env.example`,
		);

const envSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		PORT: z.coerce.number().int().positive().default(5000),
		DATABASE_URL: required("DATABASE_URL"),
		FRONTEND_URL: z.url().default("http://localhost:3000"),
		// Demo conveniences: one-click demo logins and coupon hints in the frontend,
		// and GET /api/checkout/coupons/:courseId. Off unless set (never in production).
		DEMO_MODE: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
		// Proxies between the internet and this server (1 behind Render, Railway,
		// Fly, Heroku, nginx...), so rate limits see the real client address
		TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
		// Signs access tokens (HS256); rotating it signs everyone out
		JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET").min(
			32,
			"JWT_ACCESS_SECRET must be at least 32 characters",
		),
		// jsonwebtoken / vercel-ms format, e.g. 7d, 12h, 3600
		JWT_ACCESS_EXPIRES_IN: z
			.string()
			.regex(/^\d+(ms|s|m|h|d|w|y)?$/, "Use a duration such as 7d or 12h")
			.default("7d"),
		BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(10),
		CLOUDINARY_CLOUD_NAME: required("CLOUDINARY_CLOUD_NAME"),
		CLOUDINARY_API_KEY: required("CLOUDINARY_API_KEY"),
		CLOUDINARY_API_SECRET: required("CLOUDINARY_API_SECRET"),
		// Folder prefix for every upload, so one Cloudinary account can hold several environments
		CLOUDINARY_FOLDER: z.string().default("rootover"),
		// "cloudinary", or "memory" (tests only: nothing leaves the process)
		STORAGE_DRIVER: z.enum(["cloudinary", "memory"]).default("cloudinary"),
		// Outgoing email (sign-up codes, password reset) through Resend. Optional
		// outside production: without it, emails are printed to the server console.
		RESEND_API_KEY: z.string().optional(),
		// Must use a domain verified in Resend (onboarding@resend.dev works for
		// testing, but only delivers to the Resend account's own address)
		EMAIL_FROM: z
			.string()
			.default("Root Over Education <no-reply@rootover.local>"),
		// Public base URL of this API; bKash redirects the payer back to
		// <API_PUBLIC_URL>/api/payments/bkash/callback
		API_PUBLIC_URL: z.url().default("http://localhost:5000"),
		// "bkash" (Tokenized Checkout) or "simulated" (no money moves; tests and
		// local dev). Defaults to bkash when the BKASH_* credentials are set.
		PAYMENT_PROVIDER: z.enum(["bkash", "simulated"]).optional(),
		// bKash Tokenized Checkout: BKASH_URLS.sandbox (default) or BKASH_URLS.live
		BKASH_BASE_URL: z.url().default(BKASH_URLS.sandbox),
		BKASH_USERNAME: z.string().optional(),
		BKASH_PASSWORD: z.string().optional(),
		BKASH_APP_KEY: z.string().optional(),
		BKASH_APP_SECRET: z.string().optional(),
	})
	.superRefine((env, ctx) => {
		const bkashKeys = [
			"BKASH_USERNAME",
			"BKASH_PASSWORD",
			"BKASH_APP_KEY",
			"BKASH_APP_SECRET",
		] as const;
		const provider =
			env.PAYMENT_PROVIDER ?? (env.BKASH_APP_KEY ? "bkash" : "simulated");
		if (provider === "bkash")
			for (const key of bkashKeys)
				if (!env[key] || env[key].includes("replace_me"))
					ctx.addIssue({
						code: "custom",
						path: [key],
						message: `${key} is required for bKash payments`,
					});
		if (env.NODE_ENV === "production") {
			for (const key of ["FRONTEND_URL", "API_PUBLIC_URL"] as const)
				if (!env[key].startsWith("https://"))
					ctx.addIssue({
						code: "custom",
						path: [key],
						message: `${key} must be an https URL in production`,
					});
			if (env.DEMO_MODE)
				ctx.addIssue({
					code: "custom",
					path: ["DEMO_MODE"],
					message: "DEMO_MODE must be off in production",
				});
		}
		if (env.NODE_ENV === "production" && env.STORAGE_DRIVER === "memory")
			ctx.addIssue({
				code: "custom",
				path: ["STORAGE_DRIVER"],
				message: "The memory storage driver is for tests only",
			});
		if (env.NODE_ENV === "production" && provider === "simulated")
			ctx.addIssue({
				code: "custom",
				path: ["PAYMENT_PROVIDER"],
				message: "Simulated payments are not allowed in production",
			});
		if (env.NODE_ENV === "production" && !env.RESEND_API_KEY)
			ctx.addIssue({
				code: "custom",
				path: ["RESEND_API_KEY"],
				message:
					"RESEND_API_KEY is required in production (emails would not be sent)",
			});
	});

const parsed = envSchema.safeParse(process.env);

// Fail fast with every problem listed, instead of crashing later on first use
if (!parsed.success) {
	const problems = parsed.error.issues
		.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
		.join("\n");
	console.error(
		`Invalid environment variables:\n${problems}\nSee .env.example.`,
	);
	process.exit(1);
}

const env = parsed.data;

export default {
	env: env.NODE_ENV,
	port: env.PORT,
	database_url: env.DATABASE_URL,
	frontend_url: env.FRONTEND_URL,
	demo_mode: env.DEMO_MODE,
	trust_proxy: env.TRUST_PROXY,
	jwt: {
		access_secret: env.JWT_ACCESS_SECRET,
		access_expires_in: env.JWT_ACCESS_EXPIRES_IN,
	},
	bcrypt_salt_rounds: env.BCRYPT_SALT_ROUNDS,
	cloudinary: {
		cloud_name: env.CLOUDINARY_CLOUD_NAME,
		api_key: env.CLOUDINARY_API_KEY,
		api_secret: env.CLOUDINARY_API_SECRET,
		folder: env.CLOUDINARY_FOLDER,
	},
	storage_driver: env.STORAGE_DRIVER,
	api_public_url: env.API_PUBLIC_URL.replace(/\/$/, ""),
	payment: {
		provider:
			env.PAYMENT_PROVIDER ?? (env.BKASH_APP_KEY ? "bkash" : "simulated"),
		bkash: {
			base_url: env.BKASH_BASE_URL.replace(/\/$/, ""),
			sandbox: env.BKASH_BASE_URL.includes("sandbox"),
			// False for a typo or a URL bKash didn't publish (warned at startup)
			known_url: (Object.values(BKASH_URLS) as string[]).includes(
				env.BKASH_BASE_URL.replace(/\/$/, ""),
			),
			username: env.BKASH_USERNAME ?? "",
			password: env.BKASH_PASSWORD ?? "",
			app_key: env.BKASH_APP_KEY ?? "",
			app_secret: env.BKASH_APP_SECRET ?? "",
		},
	},
	mail: {
		resend_api_key: env.RESEND_API_KEY || undefined,
		from: env.EMAIL_FROM,
	},
};
