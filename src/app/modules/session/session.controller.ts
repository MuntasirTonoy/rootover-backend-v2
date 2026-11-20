import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { SessionService } from "./session.service.js";

const list = async (req: Request, res: Response) => {
	res.json(await SessionService.list(currentUser(req), req.sessionId));
};

const revoke = async (req: Request, res: Response) => {
	await SessionService.revoke(currentUser(req), String(req.params.id));
	res.status(httpStatus.NO_CONTENT).end();
};

const revokeAll = async (req: Request, res: Response) => {
	const { others } = req.query as { others?: boolean };
	res.json(
		await SessionService.revokeAll(
			currentUser(req),
			req.sessionId,
			others ?? false,
		),
	);
};

export const SessionController = { list, revoke, revokeAll };
