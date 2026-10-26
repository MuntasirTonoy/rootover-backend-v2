import type { ErrorRequestHandler } from "express";
import httpStatus from "http-status";
import { ZodError } from "zod";
import config from "../../config/index.js";
import AppError, { type ErrorCode } from "../errors/AppError.js";
import handlePrismaError, {
	isPrismaKnownError,
} from "../errors/handlePrismaError.js";
import handleZodError from "../errors/handleZodError.js";

interface ErrorBody {
	error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}

// body-parser errors carry a `type` and an HTTP status
const isBodyParserError = (
	err: unknown,
): err is { type: string; status: number } =>
	typeof err === "object" && err !== null && "type" in err && "status" in err;

// One error shape for every failure: { error: { code, message, fields? } }
const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
	let status: number = httpStatus.INTERNAL_SERVER_ERROR;
	let body: ErrorBody = {
		error: {
			code: "INTERNAL",
			message: "Something went wrong. Please try again.",
		},
	};

	// Known Prisma constraint errors become regular AppErrors; others stay a 500
	const known = isPrismaKnownError(err) ? handlePrismaError(err) : null;
	const appError = err instanceof AppError ? err : known;

	if (appError) {
		status = appError.statusCode;
		body = {
			error: {
				code: appError.code,
				message: appError.message,
				fields: appError.fields,
			},
		};
	} else if (err instanceof ZodError) {
		status = httpStatus.BAD_REQUEST;
		body = { error: { code: "VALIDATION_ERROR", ...handleZodError(err) } };
	} else if (isBodyParserError(err) && err.type === "entity.parse.failed") {
		status = httpStatus.BAD_REQUEST;
		body = {
			error: {
				code: "VALIDATION_ERROR",
				message: "The request body is not valid JSON.",
			},
		};
	} else if (isBodyParserError(err) && err.type === "entity.too.large") {
		status = httpStatus.REQUEST_ENTITY_TOO_LARGE;
		body = {
			error: {
				code: "VALIDATION_ERROR",
				message: "The request body is too large.",
			},
		};
	}

	// Unexpected errors are logged in full but never sent to the client
	if (status >= 500) console.error(err);
	else if (config.env === "development")
		console.warn(`[${status}] ${body.error.message}`);

	res.status(status).json(body);
};

export default globalErrorHandler;
