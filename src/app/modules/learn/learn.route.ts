import { Router } from "express";
import auth, { optionalAuth } from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { ReportController as Reports } from "../report/report.controller.js";
import { ReportValidation as RV } from "../report/report.validation.js";
import { LearnController } from "./learn.controller.js";
import { LearnValidation } from "./learn.validation.js";

// Mounted at /api/learn
const router = Router();

router.get(
	"/:courseId",
	validateRequest(LearnValidation.player),
	optionalAuth,
	LearnController.getPlayer,
);
router.post(
	"/:courseId/lessons/:lessonId/watch",
	auth("student"),
	validateRequest(LearnValidation.lesson),
	LearnController.recordWatch,
);
router.put(
	"/:courseId/lessons/:lessonId/complete",
	auth("student"),
	validateRequest(LearnValidation.complete),
	LearnController.setComplete,
);

// Create or update the student's own rating of a course they bought
router.put(
	"/:courseId/review",
	auth("student"),
	validateRequest(LearnValidation.review),
	LearnController.saveReview,
);

// Any signed-in user reaches the service, which answers teachers and admins
// with the spec's own 403 message
router.post(
	"/:courseId/lessons/:lessonId/reports",
	auth(),
	validateRequest(RV.create),
	Reports.create,
);

export const LearnRoutes = router;
