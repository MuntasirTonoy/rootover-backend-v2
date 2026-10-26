import type { Request, Response } from "express";
import { TeachersService } from "./teachers.service.js";

const listTeachers = async (req: Request, res: Response) => {
	const { q, featured } = req.query as { q?: string; featured?: boolean };
	res.json(await TeachersService.listTeachers(q, featured));
};

const getTeacher = async (req: Request, res: Response) => {
	res.json(await TeachersService.getTeacher(String(req.params.id)));
};

export const TeachersController = { listTeachers, getTeacher };
