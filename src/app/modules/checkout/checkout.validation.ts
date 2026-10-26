import { z } from "zod";

const courseId = z
	.string({ error: "Choose a course." })
	.trim()
	.min(1, "Choose a course.")
	.max(64);

// Empty string = no coupon
const couponCode = z
	.string()
	.trim()
	.max(30, "Enter a valid coupon code.")
	.transform((v) => v || undefined)
	.optional();

const quote = z.object({ body: z.object({ courseId, couponCode }) });

const checkout = z.object({
	body: z.object({
		courseId,
		couponCode,
		// bKash is the only method; older clients may still send "method": it is
		// ignored (unknown keys are stripped)
	}),
});

const validCoupons = z.object({
	params: z.object({ courseId: z.string().min(1).max(64) }),
});

export const CheckoutValidation = { quote, checkout, validCoupons };
