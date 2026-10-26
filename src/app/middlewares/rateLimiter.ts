import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";

// Rate limiter that answers in the standard error shape (via globalErrorHandler)
const rateLimiter = (options: {
	windowMs: number;
	limit: number;
	message: string;
}) =>
	rateLimit({
		windowMs: options.windowMs,
		limit: options.limit,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (req, res, next) =>
			next(new AppError(httpStatus.TOO_MANY_REQUESTS, options.message)),
	});

// Login and registration: 20 requests / 15 min / IP (BACKEND_SPEC section 17)
export const authLimiter = rateLimiter({
	windowMs: 15 * 60 * 1000,
	limit: 20,
	message: "Too many attempts. Please wait a few minutes and try again.",
});

export default rateLimiter;

// File uploads: 60 / 15 min / IP
export const uploadLimiter = rateLimiter({
	windowMs: 15 * 60 * 1000,
	limit: 60,
	message: "Too many uploads. Please wait a few minutes and try again.",
});
