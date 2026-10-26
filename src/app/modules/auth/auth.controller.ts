import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser, runStrategy } from "../../middlewares/auth.js";
import { AuthService } from "./auth.service.js";

const register = async (req: Request, res: Response) => {
	const result = await AuthService.register(req.body);
	res.status(httpStatus.CREATED).json(result);
};

// passport-local verifies the credentials; failures arrive as AppErrors (401/403)
const login = async (req: Request, res: Response) => {
	const { user } = await runStrategy("local", req, res);
	if (!user) throw new Error("Local strategy returned no user");
	res.json(AuthService.session(user));
};

// Tokens are stateless: the client drops its token. A password change revokes
// every older token (User.tokenVersion).
const logout = async (req: Request, res: Response) => {
	res.status(httpStatus.NO_CONTENT).end();
};

const getMe = async (req: Request, res: Response) => {
	const result = await AuthService.getMe(currentUser(req));
	res.json(result);
};

// Confirms the sign-up code; responds like login ({ token, user })
const verifyEmail = async (req: Request, res: Response) => {
	res.json(await AuthService.verifyEmail(req.body));
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
	logout,
	getMe,
	verifyEmail,
	resendVerification,
	forgotPassword,
	resetPassword,
};
