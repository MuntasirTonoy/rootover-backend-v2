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

// Sent to every admin when a teacher application is submitted (user's request,
// 2026-11-20). Only the applicant's name and account email: identity numbers
// and documents stay in the admin dashboard, never in an inbox.
export const newApplicationAdminEmail = (
	to: string,
	application: { fullName: string; submittedAt: Date },
	applicantEmail: string,
): Mail => {
	const url = `${config.frontend_url}/admin/teacher-applications`;
	const when = application.submittedAt.toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Asia/Dhaka",
	});
	return {
		to,
		subject: `New teacher application: ${application.fullName}`,
		text: [
			"A new teacher application is waiting for review on Root Over Education.",
			"",
			`Applicant: ${application.fullName}`,
			`Account: ${applicantEmail}`,
			`Submitted: ${when} (Dhaka time)`,
			"",
			`Review it: ${url}`,
			"",
			"Root Over Education",
		].join("\n"),
		html: emailLayout({
			preheader: `${application.fullName} applied to become a teacher.`,
			heading: "New teacher application",
			body: `
<p style="margin:0 0 12px">A new teacher application is waiting for review.</p>
${detailsTable([
	["Applicant", application.fullName],
	["Account", applicantEmail],
	["Submitted", `${when} (Dhaka time)`],
	["Status", "Pending review"],
])}
<p style="margin:0 0 12px">Open the admin dashboard to check the documents, then request the registration fee or reject the application.</p>`,
			cta: { label: "Review the application", url },
			footnote:
				"You're receiving this because you're an admin of Root Over Education.",
		}),
	};
};
