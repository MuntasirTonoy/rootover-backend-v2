import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { SessionController } from "./session.controller.js";
import { SessionValidation } from "./session.validation.js";

const router = Router();

// Mounted at /api/me/sessions; every role manages its own signed-in devices
router.get("/", auth(), SessionController.list);
router.delete(
	"/",
	auth(),
	validateRequest(SessionValidation.revokeAll),
	SessionController.revokeAll,
);
router.delete(
	"/:id",
	auth(),
	validateRequest(SessionValidation.sessionId),
	SessionController.revoke,
);

export const SessionRoutes = router;
