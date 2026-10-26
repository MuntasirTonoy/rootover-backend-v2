import type { Request, Response } from "express";
import { currentUser } from "../../middlewares/auth.js";
import { AdminCourseService as Courses } from "./admin.courses.js";
import { AdminFeaturedService as Featured } from "./admin.featured.js";
import { AdminService } from "./admin.service.js";

// validateRequest has already replaced req.params / req.query with parsed values
const id = (req: Request) => String(req.params.id);
// biome-ignore lint/suspicious/noExplicitAny: the query was parsed by the route's schema
const query = (req: Request) => req.query as any;

const getOverview = async (req: Request, res: Response) => {
	res.json(await AdminService.getOverview());
};

// ---------------------------------------------------------------- courses

const listCourses = async (req: Request, res: Response) => {
	res.json(await Courses.listCourses(query(req)));
};

const getCourse = async (req: Request, res: Response) => {
	res.json(await Courses.getCourse(id(req)));
};

const approveCourse = async (req: Request, res: Response) => {
	res.json(await Courses.approve(currentUser(req), id(req)));
};

const rejectCourse = async (req: Request, res: Response) => {
	res.json(await Courses.reject(currentUser(req), id(req), req.body.reason));
};

const suspendCourse = async (req: Request, res: Response) => {
	res.json(await Courses.suspend(currentUser(req), id(req), req.body.reason));
};

// ---------------------------------------------------------------- people

const listTeachers = async (req: Request, res: Response) => {
	res.json(await AdminService.listTeachers(query(req)));
};

const listStudents = async (req: Request, res: Response) => {
	res.json(await AdminService.listStudents(query(req)));
};

const setTeacherFeatured = async (req: Request, res: Response) => {
	res.json(
		await Featured.setTeacherFeatured(
			currentUser(req),
			id(req),
			req.body.featured,
		),
	);
};

const setUserStatus = async (req: Request, res: Response) => {
	res.json(
		await AdminService.setUserStatus(
			currentUser(req),
			id(req),
			req.body.status,
		),
	);
};

const listAdmins = async (req: Request, res: Response) => {
	res.json(await AdminService.listAdmins());
};

const setUserRole = async (req: Request, res: Response) => {
	res.json(
		await AdminService.setUserRole(currentUser(req), id(req), req.body.role),
	);
};

// ---------------------------------------------------------------- money

const listRegistrationFees = async (req: Request, res: Response) => {
	res.json(await AdminService.listRegistrationFees(query(req)));
};

const listTransactions = async (req: Request, res: Response) => {
	res.json(await AdminService.listTransactions(query(req)));
};

const getTransaction = async (req: Request, res: Response) => {
	res.json(await AdminService.getTransaction(id(req)));
};

const listWithdrawals = async (req: Request, res: Response) => {
	res.json(await AdminService.listWithdrawals(query(req)));
};

const approveWithdrawal = async (req: Request, res: Response) => {
	res.json(await AdminService.approveWithdrawal(currentUser(req), id(req)));
};

const rejectWithdrawal = async (req: Request, res: Response) => {
	res.json(
		await AdminService.rejectWithdrawal(
			currentUser(req),
			id(req),
			req.body.reason,
		),
	);
};

// ---------------------------------------------------------------- reports / activity

const getReports = async (req: Request, res: Response) => {
	res.json(await AdminService.getReports());
};

const listActivity = async (req: Request, res: Response) => {
	res.json(await AdminService.listActivity(query(req)));
};

export const AdminController = {
	getOverview,
	listCourses,
	getCourse,
	approveCourse,
	rejectCourse,
	suspendCourse,
	listTeachers,
	listStudents,
	setUserStatus,
	setTeacherFeatured,
	listAdmins,
	setUserRole,
	listRegistrationFees,
	listTransactions,
	getTransaction,
	listWithdrawals,
	approveWithdrawal,
	rejectWithdrawal,
	getReports,
	listActivity,
};
