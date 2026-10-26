import type { Mail } from "../../lib/mailer.js";
import { OTP_TTL_MINUTES } from "./auth.otp.js";

// Escapes text placed into the HTML body (names are user input)
const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);

const layout = (name: string, intro: string, code: string, outro: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 20px;color:#1DB954;font-weight:bold">Root Over Education</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>${intro}</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#111827">${code}</p>
  <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
  <p style="color:#6b7280;font-size:13px">${outro}</p>
</div>`;

export const verificationEmail = (
	to: string,
	name: string,
	code: string,
): Mail => ({
	to,
	subject: `OTP for RootOver  Education Verification`,
	text: `Hi ${name},\n\nYour Root Over verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you didn't create an account, you can ignore this email.`,
	html: layout(
		name,
		"Use this code to verify your email address and finish creating your account:",
		code,
		"If you didn't create an account, you can ignore this email.",
	),
});

export const passwordResetEmail = (
	to: string,
	name: string,
	code: string,
): Mail => ({
	to,
	subject: `OTP for RootOver  Education Password Reset`,
	text: `Hi ${name},\n\nYour Root Over password reset code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you didn't ask to reset your password, you can ignore this email; your password stays the same.`,
	html: layout(
		name,
		"Use this code to reset your password:",
		code,
		"If you didn't ask to reset your password, you can ignore this email; your password stays the same.",
	),
});
