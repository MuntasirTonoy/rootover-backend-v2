import config from "../../../config/index.js";
import {
	detailsTable,
	emailLayout,
	escapeHtml,
	stepsList,
} from "../../lib/email-layout.js";
import type { Mail } from "../../lib/mailer.js";

// Sent when an admin asks the applicant for the registration fee. Paying it
// approves the application automatically (payment module).
export const feeRequestEmail = (
	to: string,
	fullName: string,
	fee: number,
): Mail => {
	const url = `${config.frontend_url}/teacher/apply`;
	const amount = `৳${fee.toLocaleString("en-US")}`;
	return {
		to,
		subject: "Your teacher application is accepted - pay the registration fee",
		text: [
			`Dear ${fullName},`,
			"",
			"Good news: we've reviewed your teacher application on Root Over Education and it's ready for the last step.",
			"",
			`Please pay the one-time teacher registration fee of ${amount} by bKash. As soon as the payment is confirmed, your teacher account is approved automatically and you can start creating courses.`,
			"",
			`Pay now: ${url}`,
			"",
			"Root Over Education",
		].join("\n"),
		html: emailLayout({
			preheader: `One step left: pay the ${amount} registration fee to activate your teacher account.`,
			heading: "Your application is ready for the final step",
			body: `
<p style="margin:0 0 12px">Dear ${escapeHtml(fullName)},</p>
<p style="margin:0 0 12px">Thank you for applying to teach on Root Over Education. Our team has reviewed your application and you're invited to complete your registration.</p>
${detailsTable([
	["Teacher registration fee", amount],
	["Payment method", "bKash"],
	["Payable", "One time"],
])}
<p style="margin:0 0 4px;font-weight:bold;color:#111827">What happens next</p>
${stepsList([
	"Open your application with the button below and choose <b>Pay with bKash</b>.",
	`Confirm the ${escapeHtml(amount)} payment in bKash.`,
	"Your teacher account is <b>approved automatically</b> as soon as the payment is confirmed, with your Teacher ID. You can start creating courses right away.",
])}`,
			cta: { label: `Pay ${amount} and get approved`, url },
			footnote:
				"You're receiving this because you applied to become a teacher on Root Over Education. If that wasn't you, you can ignore this email.",
		}),
	};
};
