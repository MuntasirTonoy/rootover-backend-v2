import type { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errors/AppError.js";
import { currentUser } from "../../middlewares/auth.js";
import { quote } from "../../utils/pricing.js";
import { toEmbedUrl } from "../../utils/youtube.js";
import { TeacherCouponService as Coupons } from "./teacher.coupons.js";
import { TeacherCourseService as Courses } from "./teacher.courses.js";
import { TeacherService } from "./teacher.service.js";

// validateRequest has already replaced req.params / req.query with parsed values
const id = (req: Request) => String(req.params.id);

// ---------------------------------------------------------------- profile

const getMe = async (req: Request, res: Response) => {
	res.json(await TeacherService.getMe(currentUser(req)));
};

const updateMe = async (req: Request, res: Response) => {
	res.json(await TeacherService.updateMe(currentUser(req), req.body));
};

const getDashboard = async (req: Request, res: Response) => {
	res.json(await TeacherService.getDashboard(currentUser(req)));
};

// ---------------------------------------------------------------- editor helpers

// The embed form of a YouTube link (watch/share/shorts/embed URL or <iframe>)
const videoLink = async (req: Request, res: Response) => {
	const embedUrl = toEmbedUrl(String(req.query.url ?? ""));
	if (!embedUrl)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			"Enter a valid YouTube link or embed code.",
		);
	res.json({ embedUrl });
};

// What a student would pay and the teacher would earn at these prices
const pricePreview = async (req: Request, res: Response) => {
	const { price, discountPrice } = req.query as unknown as {
		price: number;
		discountPrice: number | null;
	};
	res.json(quote({ price, discountPrice }));
};

// ---------------------------------------------------------------- courses

const listCourses = async (req: Request, res: Response) => {
	res.json(
		await Courses.listCourses(
			currentUser(req),
			req.query as unknown as Parameters<typeof Courses.listCourses>[1],
		),
	);
};

const createCourse = async (req: Request, res: Response) => {
	const course = await Courses.createCourse(currentUser(req), req.body);
	res.status(httpStatus.CREATED).json(course);
};

const getCourse = async (req: Request, res: Response) => {
	res.json(await Courses.getCourse(currentUser(req), id(req)));
};

const updateCourse = async (req: Request, res: Response) => {
	res.json(await Courses.updateCourse(currentUser(req), id(req), req.body));
};

const submitCourse = async (req: Request, res: Response) => {
	res.json(await Courses.submitCourse(currentUser(req), id(req)));
};

const deleteCourse = async (req: Request, res: Response) => {
	await Courses.deleteCourse(currentUser(req), id(req));
	res.status(httpStatus.NO_CONTENT).end();
};

// ---------------------------------------------------------------- students / earnings

const listStudents = async (req: Request, res: Response) => {
	res.json(
		await TeacherService.listStudents(
			currentUser(req),
			req.query as unknown as Parameters<typeof TeacherService.listStudents>[1],
		),
	);
};

const getEarnings = async (req: Request, res: Response) => {
	res.json(
		await TeacherService.getEarnings(
			currentUser(req),
			req.query as unknown as Parameters<typeof TeacherService.getEarnings>[1],
		),
	);
};

// ---------------------------------------------------------------- coupons

const listCoupons = async (req: Request, res: Response) => {
	res.json(await Coupons.listCoupons(currentUser(req)));
};

const createCoupon = async (req: Request, res: Response) => {
	const coupon = await Coupons.createCoupon(currentUser(req), req.body);
	res.status(httpStatus.CREATED).json(coupon);
};

const updateCoupon = async (req: Request, res: Response) => {
	res.json(await Coupons.updateCoupon(currentUser(req), id(req), req.body));
};

const setCouponActive = async (req: Request, res: Response) => {
	res.json(
		await Coupons.setCouponActive(currentUser(req), id(req), req.body.active),
	);
};

const deleteCoupon = async (req: Request, res: Response) => {
	await Coupons.deleteCoupon(currentUser(req), id(req));
	res.status(httpStatus.NO_CONTENT).end();
};

// ---------------------------------------------------------------- withdrawals

const listWithdrawals = async (req: Request, res: Response) => {
	res.json(await TeacherService.listWithdrawals(currentUser(req)));
};

const requestWithdrawal = async (req: Request, res: Response) => {
	const withdrawal = await TeacherService.requestWithdrawal(
		currentUser(req),
		req.body,
	);
	res.status(httpStatus.CREATED).json(withdrawal);
};

export const TeacherController = {
	videoLink,
	pricePreview,
	getMe,
	updateMe,
	getDashboard,
	listCourses,
	createCourse,
	getCourse,
	updateCourse,
	submitCourse,
	deleteCourse,
	listStudents,
	getEarnings,
	listCoupons,
	createCoupon,
	updateCoupon,
	setCouponActive,
	deleteCoupon,
	listWithdrawals,
	requestWithdrawal,
};
