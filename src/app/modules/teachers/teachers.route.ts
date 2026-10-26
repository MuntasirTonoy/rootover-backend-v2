import { Router } from "express";
import validateRequest from "../../middlewares/validateRequest.js";
import { TeachersController } from "./teachers.controller.js";
import { TeachersValidation } from "./teachers.validation.js";

// Mounted at /api/teachers (public)
const router = Router();

router.get(
	"/",
	validateRequest(TeachersValidation.listTeachers),
	TeachersController.listTeachers,
);
router.get(
	"/:id",
	validateRequest(TeachersValidation.teacherId),
	TeachersController.getTeacher,
);

export const TeachersRoutes = router;
