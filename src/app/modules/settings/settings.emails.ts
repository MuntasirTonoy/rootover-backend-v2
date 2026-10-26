import {
	codeBlock,
	detailsTable,
	emailLayout,
	escapeHtml,
} from "../../lib/email-layout.js";
import type { Mail } from "../../lib/mailer.js";
import { OTP_TTL_MINUTES } from "../auth/auth.otp.js";

type FromTo = [from: number, to: number];

const arrow = ([from, to]: FromTo, format: (n: number) => string) =>
	from === to ? `${format(to)} (unchanged)` : `${format(from)} → ${format(to)}`;

// The code an admin enters to confirm a change of the platform fees
export const settingsCodeEmail = (
	to: string,
	name: string,
	code: string,
	change: { commission: FromTo; registrationFee: FromTo },
): Mail => {
	const commission = arrow(change.commission, (n) => `${n}%`);
	const fee = arrow(change.registrationFee, (n) => `৳${n}`);
	return {
		to,
		subject: "Confirm the platform settings change - Root Over Education",
		text: `Hi ${name},\n\nUse this code to confirm the platform settings change: ${code}\n\nSale commission: ${commission}\nTeacher registration fee: ${fee}\n\nThe code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this change, don't share the code and secure your account.`,
		html: emailLayout({
			preheader: `Your confirmation code is ${code}`,
			heading: "Confirm the settings change",
			body: `
<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
<p style="margin:0">Someone signed in as you asked to change the platform fees. Enter this code in the admin panel to confirm:</p>
${codeBlock(code)}
${detailsTable([
	["Sale commission", commission],
	["Teacher registration fee", fee],
])}
<p style="margin:0">The code expires in ${OTP_TTL_MINUTES} minutes and works once.</p>`,
			footnote:
				"If you didn't request this change, don't share the code and change your password.",
		}),
	};
};
