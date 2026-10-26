import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { ApplicationService } from "./application.service.js";

const id = (req: Request) => String(req.params.id);

const getMine = async (req: Request, res: Response) => {
	res.json(await ApplicationService.getMine(currentUser(req)));
};

const submit = async (req: Request, res: Response) => {
	const application = await ApplicationService.submit(
		currentUser(req),
		req.body,
	);
	res.status(httpStatus.CREATED).json(application);
};

const payFee = async (req: Request, res: Response) => {
	res.json(await ApplicationService.payFee(currentUser(req), id(req)));
};

const adminList = async (req: Request, res: Response) => {
	const query = req.query as unknown as Parameters<
		typeof ApplicationService.adminList
	>[0];
	res.json(await ApplicationService.adminList(query));
};

const adminDetail = async (req: Request, res: Response) => {
	res.json(await ApplicationService.adminDetail(id(req)));
};

const requestPayment = async (req: Request, res: Response) => {
	res.json(await ApplicationService.requestPayment(currentUser(req), id(req)));
};

const approve = async (req: Request, res: Response) => {
	res.json(await ApplicationService.approve(currentUser(req), id(req)));
};

const reject = async (req: Request, res: Response) => {
	res.json(
		await ApplicationService.reject(currentUser(req), id(req), req.body.reason),
	);
};

export const ApplicationController = {
	getMine,
	submit,
	payFee,
	adminList,
	adminDetail,
	requestPayment,
	approve,
	reject,
};
