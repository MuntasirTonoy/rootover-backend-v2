import type { Request, RequestHandler, Response } from "express";
import httpStatus from "http-status";
import type { Role, User } from "../../generated/prisma/client.js";
import AppError from "../errors/AppError.js";
import passport from "../lib/passport.js";
import { BANNED_MESSAGE } from "../modules/auth/auth.service.js";

// Runs a Passport strategy and resolves with the user (or false) and the failure info
export const runStrategy = (
	strategy: "jwt" | "local",
	req: Request,
	res: Response,
) =>
	new Promise<{ user: User | false; info: unknown }>((resolve, reject) => {
		passport.authenticate(
			strategy,
			{ session: false },
			(err: unknown, user: User | false, info: unknown) =>
				err ? reject(err) : resolve({ user, info }),
		)(req, res, () => undefined);
	});

const isExpired = (info: unknown) =>
	info instanceof Error && info.name === "TokenExpiredError";

// Requires a valid access token and (optionally) one of the given roles.
// passport-jwt reloads the user on every request, so bans and role changes
// take effect immediately (BACKEND_SPEC section 5).
const auth =
	(...roles: Role[]): RequestHandler =>
	async (req, res, next) => {
		const { user, info } = await runStrategy("jwt", req, res);
		if (!user)
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				isExpired(info)
					? "Your session has expired. Please log in again."
					: "Please log in first.",
			);
		if (user.status === "banned")
			throw new AppError(httpStatus.FORBIDDEN, BANNED_MESSAGE);
		if (roles.length && !roles.includes(user.role))
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You don't have permission to do this.",
			);

		req.user = user;
		next();
	};

// For public routes where a token only unlocks more (e.g. owned lessons).
// No token, an invalid/expired token or a banned account continue as a guest.
export const optionalAuth: RequestHandler = async (req, res, next) => {
	if (req.headers.authorization) {
		const { user } = await runStrategy("jwt", req, res);
		if (user && user.status === "active") req.user = user;
	}
	next();
};

// The signed-in user in a controller behind `auth()`; throws if the route forgot the middleware
export const currentUser = (req: Request): User => {
	if (!req.user)
		throw new AppError(httpStatus.UNAUTHORIZED, "Please log in first.");
	return req.user;
};

export default auth;
