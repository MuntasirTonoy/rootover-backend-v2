import { Router } from "express";
import auth from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { ApplicationController } from "./application.controller.js";
import { ApplicationValidation as V } from "./application.validation.js";

// Mounted at /api/me: the signed-in user's latest application (any role)
const meRouter = Router();
meRouter.get("/teacher-application", auth(), ApplicationController.getMine);

// Mounted at /api/teacher-applications. The service answers non-students with
// a specific 403; paying is limited to the applicant's own application.
const router = Router();
router.post(
	"/",
	auth(),
	validateRequest(V.submit),
	ApplicationController.submit,
);
router.post(
	"/:id/pay-fee",
	auth(),
	validateRequest(V.payFee),
	ApplicationController.payFee,
);

// Mounted at /api/admin/teacher-applications
const adminRouter = Router();
const admin = auth("admin");
adminRouter.get(
	"/",
	admin,
	validateRequest(V.adminList),
	ApplicationController.adminList,
);
adminRouter.get(
	"/:id",
	admin,
	validateRequest(V.id),
	ApplicationController.adminDetail,
);
adminRouter.post(
	"/:id/request-payment",
	admin,
	validateRequest(V.id),
	ApplicationController.requestPayment,
);
adminRouter.post(
	"/:id/approve",
	admin,
	validateRequest(V.id),
	ApplicationController.approve,
);
adminRouter.post(
	"/:id/reject",
	admin,
	validateRequest(V.reject),
	ApplicationController.reject,
);

export const ApplicationMeRoutes = meRouter;
export const ApplicationRoutes = router;
export const AdminApplicationRoutes = adminRouter;
