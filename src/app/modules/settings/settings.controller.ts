import type { Request, Response } from "express";
import { currentUser } from "../../middlewares/auth.js";
import { SettingsService } from "./settings.service.js";

const view = async (_req: Request, res: Response) => {
	res.json(await SettingsService.view());
};

const requestCode = async (req: Request, res: Response) => {
	res.json(await SettingsService.requestCode(currentUser(req), req.body));
};

const save = async (req: Request, res: Response) => {
	res.json(await SettingsService.save(currentUser(req), req.body));
};

export const SettingsController = { view, requestCode, save };
