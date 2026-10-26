import type { Request, Response } from "express";
import { currentUser } from "../../middlewares/auth.js";
import { UserService } from "./user.service.js";

const updateMe = async (req: Request, res: Response) => {
	const result = await UserService.updateMe(currentUser(req), req.body);
	res.json(result);
};

export const UserController = { updateMe };
