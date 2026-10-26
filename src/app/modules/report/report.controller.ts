import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { ReportService } from "./report.service.js";
import type { ReportListQuery } from "./report.validation.js";

// Mounted by the learn, student (/me), teacher and admin routers; their
// validateRequest has already parsed req.params / req.query
const id = (req: Request) => String(req.params.id);
const listQuery = (req: Request) => req.query as unknown as ReportListQuery;

const create = async (req: Request, res: Response) => {
	const report = await ReportService.create(
		currentUser(req),
		String(req.params.courseId),
		String(req.params.lessonId),
		req.body,
	);
	res.status(httpStatus.CREATED).json(report);
};

const mine = async (req: Request, res: Response) => {
	res.json(await ReportService.mine(currentUser(req)));
};

const teacherList = async (req: Request, res: Response) => {
	res.json(await ReportService.teacherList(currentUser(req), listQuery(req)));
};

const submitFix = async (req: Request, res: Response) => {
	res.json(
		await ReportService.submitFix(currentUser(req), id(req), req.body.note),
	);
};

const adminList = async (req: Request, res: Response) => {
	res.json(await ReportService.adminList(listQuery(req)));
};

const approveFix = async (req: Request, res: Response) => {
	res.json(
		await ReportService.approveFix(currentUser(req), id(req), req.body?.note),
	);
};

const rejectFix = async (req: Request, res: Response) => {
	res.json(
		await ReportService.rejectFix(currentUser(req), id(req), req.body.reason),
	);
};

export const ReportController = {
	create,
	mine,
	teacherList,
	submitFix,
	adminList,
	approveFix,
	rejectFix,
};
