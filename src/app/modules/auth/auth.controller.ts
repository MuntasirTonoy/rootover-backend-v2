import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser, runStrategy } from "../../middlewares/auth.js";
import { SessionService } from "../session/session.service.js";
import { AuthService } from "./auth.service.js";

// The device a login comes from. `replaceSessionId` (login and Google only) is
// the device the user chose to log out after a 409 DEVICE_LIMIT.
const deviceOf = (req: Request) => ({
	userAgent: req.get("user-agent"),
	ip: req.ip,
	replaceSessionId:
		typeof req.body?.replaceSessionId === "string"
			? req.body.replaceSessionId
			: undefined,
});

const register = async (req: Request, res: Response) => {
	const result = await AuthService.register(req.body);
	res.status(httpStatus.CREATED).json(result);
};

// passport-local verifies the credentials; failures arrive as AppErrors (401/403)
const login = async (req: Request, res: Response) => {
	const { user } = await runStrategy("local", req, res);
	if (!user) throw new Error("Local strategy returned no user");
	res.json(await AuthService.session(user, deviceOf(req)));
};

// Logs this device out: its LoginSession row is deleted, so the token stops working
const logout = async (req: Request, res: Response) => {
	await SessionService.end(req.sessionId);
	res.status(httpStatus.NO_CONTENT).end();
};

const getMe = async (req: Request, res: Response) => {
	const result = await AuthService.getMe(currentUser(req));
	res.json(result);
};

// Confirms the sign-up code; responds like login ({ token, user })
const verifyEmail = async (req: Request, res: Response) => {
	res.json(await AuthService.verifyEmail(req.body, deviceOf(req)));
};

// "Continue with Google"; responds like login ({ token, user })
const google = async (req: Request, res: Response) => {
	res.json(await AuthService.googleLogin(req.body, deviceOf(req)));
};

const resendVerification = async (req: Request, res: Response) => {
	res.json(await AuthService.resendVerification(req.body));
};

const forgotPassword = async (req: Request, res: Response) => {
	res.json(await AuthService.forgotPassword(req.body));
};

const resetPassword = async (req: Request, res: Response) => {
	res.json(await AuthService.resetPassword(req.body));
};

export const AuthController = {
	register,
	login,
	google,
	logout,
	getMe,
	verifyEmail,
	resendVerification,
	forgotPassword,
	resetPassword,
};
