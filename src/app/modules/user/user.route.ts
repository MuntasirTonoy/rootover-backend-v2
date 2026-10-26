import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { UserController } from "./user.controller.js";
import { UserValidation } from "./user.validation.js";

const router = Router();

// Mounted at /api/me; any signed-in role can edit their own profile
router.patch(
	"/",
	auth(),
	validateRequest(UserValidation.updateMe),
	UserController.updateMe,
);

export const UserRoutes = router;
