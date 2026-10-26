import type { Request, Response } from "express";
import httpStatus from "http-status";
import { currentUser } from "../../middlewares/auth.js";
import { CheckoutService } from "./checkout.service.js";

const quote = async (req: Request, res: Response) => {
	res.json(await CheckoutService.getQuote(currentUser(req), req.body));
};

const validCoupons = async (req: Request, res: Response) => {
	res.json(
		await CheckoutService.validCouponCodes(
			currentUser(req),
			String(req.params.courseId),
		),
	);
};

const checkout = async (req: Request, res: Response) => {
	const result = await CheckoutService.checkout(currentUser(req), req.body);
	res.status(httpStatus.CREATED).json(result);
};

export const CheckoutController = { quote, validCoupons, checkout };
