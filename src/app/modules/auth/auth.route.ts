import { Router } from "express";
import auth from "../../middlewares/auth.js";
import { authLimiter } from "../../middlewares/rateLimiter.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import { AuthValidation } from "./auth.validation.js";

const router = Router();

// Mounted at /api/auth. Everything that takes credentials or codes shares
// authLimiter; codes also have their own attempt limit and resend cooldown.
router.post(
	"/register",
	authLimiter,
	validateRequest(AuthValidation.register),
	AuthController.register,
);
router.post(
	"/verify-email",
	authLimiter,
	validateRequest(AuthValidation.verifyEmail),
	AuthController.verifyEmail,
);
router.post(
	"/resend-verification",
	authLimiter,
	validateRequest(AuthValidation.resendVerification),
	AuthController.resendVerification,
);
router.post(
	"/login",
	authLimiter,
	validateRequest(AuthValidation.login),
	AuthController.login,
);
router.post(
	"/google",
	authLimiter,
	validateRequest(AuthValidation.google),
	AuthController.google,
);
router.post(
	"/forgot-password",
	authLimiter,
	validateRequest(AuthValidation.forgotPassword),
	AuthController.forgotPassword,
);
router.post(
	"/reset-password",
	authLimiter,
	validateRequest(AuthValidation.resetPassword),
	AuthController.resetPassword,
);
router.post("/logout", auth(), AuthController.logout);
router.get("/me", auth(), AuthController.getMe);

export const AuthRoutes = router;
