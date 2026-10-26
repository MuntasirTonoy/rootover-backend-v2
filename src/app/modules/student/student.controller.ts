import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { StudentService } from "./student.service.js";

type Query<K extends keyof typeof StudentService> = Parameters<
	(typeof StudentService)[K]
>[1];

const listEnrollments = async (req: Request, res: Response) => {
	res.json(
		await StudentService.listEnrollments(
			currentUser(req),
			req.query as Query<"listEnrollments">,
		),
	);
};

const getDashboard = async (req: Request, res: Response) => {
	res.json(await StudentService.getDashboard(currentUser(req)));
};

const listSaved = async (req: Request, res: Response) => {
	res.json(
		await StudentService.listSaved(
			currentUser(req),
			req.query as Query<"listSaved">,
		),
	);
};

const saveLesson = async (req: Request, res: Response) => {
	const saved = await StudentService.saveLesson(currentUser(req), req.body);
	res.status(httpStatus.CREATED).json(saved);
};

const unsaveLesson = async (req: Request, res: Response) => {
	await StudentService.unsaveLesson(
		currentUser(req),
		String(req.params.lessonId),
	);
	res.status(httpStatus.NO_CONTENT).end();
};

const listPurchases = async (req: Request, res: Response) => {
	res.json(await StudentService.listPurchases(currentUser(req)));
};

export const StudentController = {
	listEnrollments,
	getDashboard,
	listSaved,
	saveLesson,
	unsaveLesson,
	listPurchases,
};
