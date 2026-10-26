import httpStatus from "http-status";

// Error codes the frontend switches on (BACKEND_SPEC section 3)
export type ErrorCode =
	| "VALIDATION_ERROR"
	| "UNAUTHENTICATED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "BUSINESS_RULE"
	// Not in the spec's table: rate limiters, and login before the email is verified
	| "TOO_MANY_REQUESTS"
	| "EMAIL_NOT_VERIFIED"
	// 502: bKash failed or didn't answer
	| "PAYMENT_GATEWAY"
	| "INTERNAL";

const codeByStatus: Record<number, ErrorCode> = {
	[httpStatus.BAD_REQUEST]: "VALIDATION_ERROR",
	[httpStatus.UNAUTHORIZED]: "UNAUTHENTICATED",
	[httpStatus.FORBIDDEN]: "FORBIDDEN",
	[httpStatus.NOT_FOUND]: "NOT_FOUND",
	[httpStatus.CONFLICT]: "CONFLICT",
	[httpStatus.UNPROCESSABLE_ENTITY]: "BUSINESS_RULE",
	[httpStatus.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
	[httpStatus.BAD_GATEWAY]: "PAYMENT_GATEWAY",
};

// Expected failures thrown from services; the message is safe to show to users
class AppError extends Error {
	statusCode: number;
	code: ErrorCode;
	fields?: Record<string, string>;

	constructor(
		statusCode: number,
		message: string,
		fields?: Record<string, string>,
		// Overrides the code derived from the status (e.g. 403 EMAIL_NOT_VERIFIED)
		code?: ErrorCode,
	) {
		super(message);
		this.name = "AppError";
		this.statusCode = statusCode;
		this.code = code ?? codeByStatus[statusCode] ?? "INTERNAL";
		this.fields = fields;
	}
}

export default AppError;
