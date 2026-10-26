import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { paymentProvider } from "../../lib/payment.js";
import auth, { currentUser } from "../../middlewares/auth.js";
import validateRequest from "../../middlewares/validateRequest.js";
import { PaymentService } from "./payment.service.js";

const callbackQuery = z.object({
	query: z.object({
		paymentID: z.string().trim().min(1).max(100),
		status: z.string().trim().max(20).default("failure"),
	}),
});

const idParam = z.object({
	params: z.object({ id: z.string().min(1).max(64) }),
});

// Mounted at /api/payments.
// The callback is opened by the payer's browser when bKash sends them back, so
// it has no auth; it only ever confirms a payment with bKash itself.
const router = Router();

router.get(
	`/${paymentProvider.name}/callback`,
	validateRequest(callbackQuery),
	async (req: Request, res: Response) => {
		const { paymentID, status } = req.query as unknown as z.infer<
			typeof callbackQuery
		>["query"];
		res.redirect(303, await PaymentService.handleCallback(paymentID, status));
	},
);

router.get(
	"/:id",
	auth(),
	validateRequest(idParam),
	async (req: Request, res: Response) => {
		res.json(
			await PaymentService.getPayment(currentUser(req), String(req.params.id)),
		);
	},
);

export const PaymentRoutes = router;
