import { z } from "zod";

const COMMISSION = "Enter a commission from 0 to 50%.";
const FEE = "Enter a whole fee from ৳0 to ৳100000.";

const change = {
	commissionPercent: z
		.number({ error: COMMISSION })
		.min(0, COMMISSION)
		.max(50, COMMISSION)
		.refine((n) => Math.round(n * 100) === n * 100, {
			error: "Use at most 2 decimals.",
		}),
	registrationFee: z
		.number({ error: FEE })
		.int(FEE)
		.min(0, FEE)
		.max(100_000, FEE),
};

const requestCode = z.object({ body: z.object(change) });

const save = z.object({
	body: z.object({
		...change,
		code: z
			.string({ error: "Enter the 6-digit code from the email." })
			.trim()
			.regex(/^\d{6}$/, "Enter the 6-digit code from the email."),
	}),
});

export const SettingsValidation = { requestCode, save };
