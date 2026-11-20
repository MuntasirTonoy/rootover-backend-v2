import { Router } from "express";
import auth, { optionalAuth } from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutValidation } from "./checkout.validation.js";

// Mounted at /api/checkout. Any signed-in user reaches the service, which
// answers non-students with the spec's own 403 message.
const router = Router();

router.post(
	"/quote",
	auth(),
	validateRequest(CheckoutValidation.quote),
	CheckoutController.quote,
);
router.get(
	"/coupons/:courseId",
	auth(),
	validateRequest(CheckoutValidation.validCoupons),
	CheckoutController.validCoupons,
);
// Guests may price a cart too (a cart is filled before logging in)
router.post(
	"/cart/quote",
	optionalAuth,
	validateRequest(CheckoutValidation.cart),
	CheckoutController.cartQuote,
);
router.post(
	"/cart",
	auth(),
	validateRequest(CheckoutValidation.cart),
	CheckoutController.cartCheckout,
);
router.post(
	"/",
	auth(),
	validateRequest(CheckoutValidation.checkout),
	CheckoutController.checkout,
);

export const CheckoutRoutes = router;
