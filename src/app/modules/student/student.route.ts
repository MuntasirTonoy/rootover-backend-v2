import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { ReportController as Reports } from "../report/report.controller.js";
import { StudentController } from "./student.controller.js";
import { StudentValidation } from "./student.validation.js";

// Mounted at /api/me next to the profile routes; students only, except the
// enrollments list, which teachers also use for courses they bought before
// (admins have no My Classes / Saved Videos)
const router = Router();
const student = auth("student");

router.get(
	"/enrollments",
	auth("student", "teacher"),
	validateRequest(StudentValidation.enrollments),
	StudentController.listEnrollments,
);
router.get("/dashboard", student, StudentController.getDashboard);
router.get(
	"/saved-lessons",
	student,
	validateRequest(StudentValidation.savedLessons),
	StudentController.listSaved,
);
router.post(
	"/saved-lessons",
	student,
	validateRequest(StudentValidation.saveLesson),
	StudentController.saveLesson,
);
router.delete(
	"/saved-lessons/:lessonId",
	student,
	validateRequest(StudentValidation.unsaveLesson),
	StudentController.unsaveLesson,
);
router.get("/purchases", student, StudentController.listPurchases);
router.get("/video-reports", student, Reports.mine);

export const StudentRoutes = router;
