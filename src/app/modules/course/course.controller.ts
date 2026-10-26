import type { Request, Response } from "express";
import { CourseService } from "./course.service.js";

const listCourses = async (req: Request, res: Response) => {
	// validateRequest has replaced req.query with the parsed query
	const query = req.query as unknown as Parameters<
		typeof CourseService.listCourses
	>[0];
	res.json(await CourseService.listCourses(query));
};

const facets = async (req: Request, res: Response) => {
	res.json(await CourseService.facets());
};

// optionalAuth: a token unlocks owned/enrolled lessons and progress
const getCourse = async (req: Request, res: Response) => {
	res.json(await CourseService.getCourse(String(req.params.id), req.user));
};

const freePreviews = async (req: Request, res: Response) => {
	res.json(await CourseService.freePreviews());
};

export const CourseController = {
	listCourses,
	facets,
	getCourse,
	freePreviews,
};
