import httpStatus from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "./AppError.js";

// Services check business rules first and throw the spec's exact messages; these
// are the fallbacks for constraint violations that slip through (e.g. races).
const handlePrismaError = (
	error: Prisma.PrismaClientKnownRequestError,
): AppError | null => {
	switch (error.code) {
		// Unique constraint
		case "P2002":
			return new AppError(
				httpStatus.CONFLICT,
				"A record with this value already exists.",
			);
		// Foreign key constraint (e.g. deleting a row other records still use)
		case "P2003":
			return new AppError(
				httpStatus.CONFLICT,
				"This record is still used by other data.",
			);
		// Record required for the operation was not found
		case "P2025":
			return new AppError(httpStatus.NOT_FOUND, "Record not found.");
		default:
			return null;
	}
};

export const isPrismaKnownError = (
	error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
	error instanceof Prisma.PrismaClientKnownRequestError;

export default handlePrismaError;
