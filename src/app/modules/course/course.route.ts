import { Router } from "express";
import { optionalAuth } from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { CourseController } from "./course.controller.js";
import { CourseValidation } from "./course.validation.js";

// Mounted at /api/courses (public; a token is optional)
const router = Router();

router.get(
	"/",
	validateRequest(CourseValidation.listCourses),
	CourseController.listCourses,
);
// Before /:id so "facets" isn't read as a course id
router.get("/facets", CourseController.facets);
router.get(
	"/:id",
	validateRequest(CourseValidation.courseId),
	optionalAuth,
	CourseController.getCourse,
);

// Mounted at /api/free-previews
const freePreviewRouter = Router();
freePreviewRouter.get("/", CourseController.freePreviews);

export const CourseRoutes = router;
export const FreePreviewRoutes = freePreviewRouter;
