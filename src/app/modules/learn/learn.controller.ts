import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { LearnService } from "./learn.service.js";

// optionalAuth: guests get free previews, a token unlocks owned lessons
const getPlayer = async (req: Request, res: Response) => {
	res.json(await LearnService.getPlayer(String(req.params.courseId), req.user));
};

const recordWatch = async (req: Request, res: Response) => {
	await LearnService.recordWatch(
		currentUser(req),
		String(req.params.courseId),
		String(req.params.lessonId),
	);
	res.status(httpStatus.NO_CONTENT).end();
};

const setComplete = async (req: Request, res: Response) => {
	res.json(
		await LearnService.setComplete(
			currentUser(req),
			String(req.params.courseId),
			String(req.params.lessonId),
			req.body.done,
		),
	);
};

const rateCourse = async (req: Request, res: Response) => {
	res.json(
		await LearnService.rateCourse(
			currentUser(req),
			String(req.params.courseId),
			req.body.rating,
		),
	);
};

export const LearnController = {
	getPlayer,
	recordWatch,
	setComplete,
	rateCourse,
};
