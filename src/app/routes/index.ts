import { type Request, type Response, Router } from "express";
import config from "../../config/index.js";
import { paymentProvider } from "../lib/payment.js";
import { AVATAR_PRESETS } from "../utils/constants.js";
import {
	AdminApplicationRoutes,
	ApplicationMeRoutes,
	ApplicationRoutes,
} from "../modules/application/application.route.js";
import { AdminRoutes } from "../modules/admin/admin.route.js";
import { AuthRoutes } from "../modules/auth/auth.route.js";
import { CheckoutRoutes } from "../modules/checkout/checkout.route.js";
import {
	CourseRoutes,
	FreePreviewRoutes,
} from "../modules/course/course.route.js";
import { LearnRoutes } from "../modules/learn/learn.route.js";
import { PaymentRoutes } from "../modules/payment/payment.route.js";
import { StudentRoutes } from "../modules/student/student.route.js";
import { TeacherRoutes } from "../modules/teacher/teacher.route.js";
import { TeachersRoutes } from "../modules/teachers/teachers.route.js";
import { UploadRoutes } from "../modules/upload/upload.route.js";
import { UserRoutes } from "../modules/user/user.route.js";

import {
	CLEARING_DAYS,
	COMMISSION_RATE,
	MIN_WITHDRAWAL,
	REGISTRATION_FEE,
} from "../utils/pricing.js";

const router = Router();

router.get("/health", (req: Request, res: Response) => {
	res.json({ status: "ok", time: new Date().toISOString() });
});

// Platform constants the frontend displays (it keeps no copy of them)
router.get("/config", (req: Request, res: Response) => {
	res.json({
		commissionRate: COMMISSION_RATE,
		registrationFee: REGISTRATION_FEE,
		clearingDays: CLEARING_DAYS,
		minWithdrawal: MIN_WITHDRAWAL,
		avatarPresets: AVATAR_PRESETS,
		demo: config.demo_mode,
		// null = "Continue with Google" is off
		googleClientId: config.google_client_id ?? null,
		payment: {
			provider: paymentProvider.name,
			sandbox: paymentProvider.name === "bkash" && config.payment.bkash.sandbox,
		},
	});
});

// Every feature module registers here; all paths are under /api
const moduleRoutes: { path: string; route: Router }[] = [
	{ path: "/auth", route: AuthRoutes },
	{ path: "/me", route: UserRoutes },
	{ path: "/me", route: StudentRoutes },
	{ path: "/me", route: ApplicationMeRoutes },
	{ path: "/courses", route: CourseRoutes },
	{ path: "/free-previews", route: FreePreviewRoutes },
	{ path: "/teachers", route: TeachersRoutes },
	{ path: "/teacher", route: TeacherRoutes },
	{ path: "/learn", route: LearnRoutes },
	{ path: "/checkout", route: CheckoutRoutes },
	{ path: "/payments", route: PaymentRoutes },
	{ path: "/uploads", route: UploadRoutes },
	{ path: "/teacher-applications", route: ApplicationRoutes },
	{ path: "/admin/teacher-applications", route: AdminApplicationRoutes },
	{ path: "/admin", route: AdminRoutes },
];

for (const { path, route } of moduleRoutes) router.use(path, route);

export default router;
