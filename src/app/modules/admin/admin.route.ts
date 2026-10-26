import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { ReportController as Reports } from "../report/report.controller.js";
import { ReportValidation as RV } from "../report/report.validation.js";
import { AdminController as C } from "./admin.controller.js";
import { AdminValidation as V } from "./admin.validation.js";

// Mounted at /api/admin, admins only. Teacher applications are mounted
// separately (/api/admin/teacher-applications, application module); video
// reports are handled by the report module.
const router = Router();
router.use(auth("admin"));

router.get("/overview", C.getOverview);

router.get("/courses", validateRequest(V.listCourses), C.listCourses);
router.get("/courses/:id", validateRequest(V.idParam), C.getCourse);
router.post(
	"/courses/:id/approve",
	validateRequest(V.idParam),
	C.approveCourse,
);
router.post(
	"/courses/:id/reject",
	validateRequest(V.rejectCourse),
	C.rejectCourse,
);
router.post(
	"/courses/:id/suspend",
	validateRequest(V.suspendCourse),
	C.suspendCourse,
);

router.get("/teachers", validateRequest(V.listTeachers), C.listTeachers);
router.get("/students", validateRequest(V.listStudents), C.listStudents);
router.patch(
	"/users/:id/status",
	validateRequest(V.setUserStatus),
	C.setUserStatus,
);
// Admins: list them, make a student an admin, or remove an admin's role
router.get("/admins", C.listAdmins);
router.patch("/users/:id/role", validateRequest(V.setUserRole), C.setUserRole);

router.get(
	"/registration-fees",
	validateRequest(V.listRegistrationFees),
	C.listRegistrationFees,
);
router.get(
	"/transactions",
	validateRequest(V.listTransactions),
	C.listTransactions,
);
router.get("/transactions/:id", validateRequest(V.idParam), C.getTransaction);
router.get(
	"/withdrawals",
	validateRequest(V.listWithdrawals),
	C.listWithdrawals,
);
router.post(
	"/withdrawals/:id/approve",
	validateRequest(V.idParam),
	C.approveWithdrawal,
);
router.post(
	"/withdrawals/:id/reject",
	validateRequest(V.rejectWithdrawal),
	C.rejectWithdrawal,
);

router.get("/reports", C.getReports);
router.get("/activity-logs", validateRequest(V.listActivity), C.listActivity);

router.get("/video-reports", validateRequest(RV.list), Reports.adminList);
router.post(
	"/video-reports/:id/approve-fix",
	validateRequest(RV.approveFix),
	Reports.approveFix,
);
router.post(
	"/video-reports/:id/reject-fix",
	validateRequest(RV.rejectFix),
	Reports.rejectFix,
);

export const AdminRoutes = router;
