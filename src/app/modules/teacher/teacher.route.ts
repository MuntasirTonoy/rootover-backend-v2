import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { ReportController as Reports } from "../report/report.controller.js";
import { ReportValidation as RV } from "../report/report.validation.js";
import { TeacherController as C } from "./teacher.controller.js";
import { TeacherValidation as V } from "./teacher.validation.js";

// Mounted at /api/teacher. Teacher role only; the services also require a
// TeacherProfile and scope every query to it.
const router = Router();
router.use(auth("teacher"));

router.get("/me", C.getMe);
router.patch("/me", validateRequest(V.updateProfile), C.updateMe);
router.get("/dashboard", C.getDashboard);

// Course editor helpers: the backend owns link parsing and money maths
router.get("/video-link", validateRequest(V.videoLink), C.videoLink);
router.get("/price-preview", validateRequest(V.pricePreview), C.pricePreview);

router.get("/courses", validateRequest(V.listCourses), C.listCourses);
router.post("/courses", validateRequest(V.createCourse), C.createCourse);
router.get("/courses/:id", validateRequest(V.courseId), C.getCourse);
router.put("/courses/:id", validateRequest(V.updateCourse), C.updateCourse);
router.post("/courses/:id/submit", validateRequest(V.courseId), C.submitCourse);
router.delete("/courses/:id", validateRequest(V.courseId), C.deleteCourse);

router.get("/students", validateRequest(V.students), C.listStudents);
router.get("/earnings", validateRequest(V.earnings), C.getEarnings);

router.get("/coupons", C.listCoupons);
router.post("/coupons", validateRequest(V.createCoupon), C.createCoupon);
router.put("/coupons/:id", validateRequest(V.updateCoupon), C.updateCoupon);
router.patch(
	"/coupons/:id/active",
	validateRequest(V.setCouponActive),
	C.setCouponActive,
);
router.delete("/coupons/:id", validateRequest(V.couponId), C.deleteCoupon);

router.get("/withdrawals", C.listWithdrawals);
router.post(
	"/withdrawals",
	validateRequest(V.requestWithdrawal),
	C.requestWithdrawal,
);

router.get("/reports", validateRequest(RV.list), Reports.teacherList);
router.post(
	"/reports/:id/submit-fix",
	validateRequest(RV.submitFix),
	Reports.submitFix,
);

export const TeacherRoutes = router;
