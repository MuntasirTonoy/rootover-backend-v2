import type { Request, Response } from "express";
import { TeachersService } from "./teachers.service.js";

const listTeachers = async (req: Request, res: Response) => {
	const { q } = req.query as { q?: string };
	res.json(await TeachersService.listTeachers(q));
};

const getTeacher = async (req: Request, res: Response) => {
	res.json(await TeachersService.getTeacher(String(req.params.id)));
};

export const TeachersController = { listTeachers, getTeacher };
