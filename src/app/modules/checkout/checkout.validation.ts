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

// The cart: up to MAX_CART_ITEMS different courses, each with an optional coupon
export const MAX_CART_ITEMS = 20;
const cart = z.object({
	body: z.object({
		items: z
			.array(z.object({ courseId, couponCode }), {
				error: "Your cart is empty.",
			})
			.min(1, "Your cart is empty.")
			.max(MAX_CART_ITEMS, `Buy at most ${MAX_CART_ITEMS} courses at once.`)
			.refine(
				(items) => new Set(items.map((i) => i.courseId)).size === items.length,
				"Each course can only be in the cart once.",
			),
	}),
});

const validCoupons = z.object({
	params: z.object({ courseId: z.string().min(1).max(64) }),
});

export const CheckoutValidation = { quote, checkout, cart, validCoupons };
