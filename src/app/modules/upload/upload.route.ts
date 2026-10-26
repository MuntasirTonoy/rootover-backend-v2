import { type Request, type Response, Router } from "express";
import httpStatus from "http-status";
import multer from "multer";
import { z } from "zod";
import AppError from "../../errors/AppError.js";
import auth, { currentUser } from "../../middlewares/auth.js";
import { uploadLimiter } from "../../middlewares/rateLimiter.js";
import validateRequest from "../../middlewares/validateRequest.js";
import {
	MAX_UPLOAD_BYTES,
	UPLOAD_PURPOSES,
	UploadService,
} from "./upload.service.js";

const TOO_BIG = "Files must be 5 MB or smaller.";

// One file in memory (it goes straight on to storage), field "file"
const receiveFile = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
}).single("file");

const BAD_FORM = 'Send one file in the "file" field.';

// Multer's errors, and multipart data it can't parse at all, as 400s in the
// standard error shape
const fileUpload = (
	req: Request,
	res: Response,
	next: (err?: unknown) => void,
) =>
	receiveFile(req, res, (err: unknown) => {
		if (!err) return next();
		const tooBig =
			err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
		next(
			tooBig
				? new AppError(httpStatus.BAD_REQUEST, TOO_BIG, { file: TOO_BIG })
				: new AppError(httpStatus.BAD_REQUEST, BAD_FORM, { file: BAD_FORM }),
		);
	});

const create = z.object({
	body: z.object({
		purpose: z.enum(UPLOAD_PURPOSES, {
			error: "purpose must be avatar, thumbnail or application-doc.",
		}),
	}),
});

const idParam = z.object({
	params: z.object({ id: z.string().min(1).max(64) }),
});

// Mounted at /api/uploads
const router = Router();

router.post(
	"/",
	uploadLimiter,
	auth(),
	fileUpload,
	validateRequest(create),
	async (req: Request, res: Response) => {
		const upload = await UploadService.create(
			currentUser(req),
			req.body.purpose,
			req.file,
		);
		res.status(httpStatus.CREATED).json(upload);
	},
);

router.get(
	"/private/:id",
	auth(),
	validateRequest(idParam),
	async (req: Request, res: Response) => {
		res.json(
			await UploadService.privateLink(currentUser(req), String(req.params.id)),
		);
	},
);

export const UploadRoutes = router;
