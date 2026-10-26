import httpStatus from "http-status";
import type { z } from "zod";
import type { OtpPurpose, User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import { isPrismaKnownError } from "../../errors/handlePrismaError.js";
import { type Mail, sendMail } from "../../lib/mailer.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import {
	toTeacherProfileResponse,
	toUserResponse,
} from "../user/user.utils.js";
import { passwordResetEmail, verificationEmail } from "./auth.emails.js";
import {
	cooldownLeft,
	consumeOtp,
	INVALID_CODE,
	issueOtp,
	OTP_RESEND_COOLDOWN_SECONDS,
} from "./auth.otp.js";
import {
	DUMMY_PASSWORD_HASH,
	hashPassword,
	normaliseEmail,
	signAccessToken,
	verifyPassword,
} from "./auth.utils.js";
import type { AuthValidation } from "./auth.validation.js";

type Body<K extends keyof typeof AuthValidation> = z.infer<
	(typeof AuthValidation)[K]
>["body"];

export const BANNED_MESSAGE =
	"This account has been suspended by an administrator.";

const EMAIL_TAKEN = "An account with this email already exists.";

// Same answer whether or not the account exists, so these endpoints can't be
// used to find out which emails are registered
const VERIFICATION_SENT =
	"If an unverified account exists for this email, we've sent it a new code.";
const RESET_SENT =
	"If an account exists for this email, we've sent it a password reset code.";

const session = (user: User) => ({
	token: signAccessToken(user),
	user: toUserResponse(user),
});

const invalidCode = () =>
	new AppError(httpStatus.BAD_REQUEST, INVALID_CODE, { code: INVALID_CODE });

// Issues a code and emails it. If sending fails the code is withdrawn, so the
// resend cooldown doesn't block the user from trying again.
const deliverOtp = async (
	user: User,
	purpose: OtpPurpose,
	email: (to: string, name: string, code: string) => Mail,
) => {
	const { id, code } = await issueOtp(user, purpose);
	try {
		await sendMail(email(user.email, user.name, code));
	} catch (err) {
		await prisma.emailOtp.delete({ where: { id } }).catch(() => undefined);
		throw err;
	}
};

// Every account starts as an unverified student (BACKEND_SPEC section 5). No
// token is issued until the emailed code is confirmed at /verify-email.
const register = async (input: Body<"register">) => {
	const email = normaliseEmail(input.email);
	const passwordHash = await hashPassword(input.password);
	const existing = await prisma.user.findUnique({ where: { email } });
	if (existing?.emailVerifiedAt)
		throw new AppError(httpStatus.CONFLICT, EMAIL_TAKEN, {
			email: EMAIL_TAKEN,
		});

	let user: User;
	if (existing) {
		// Never verified, so nobody has proven they own this email yet: the new
		// registration replaces the old details and gets a fresh code
		user = await prisma.user.update({
			where: { id: existing.id },
			data: { name: input.name, passwordHash },
		});
	} else {
		try {
			user = await prisma.$transaction(async (tx) => {
				const created = await tx.user.create({
					data: { name: input.name, email, passwordHash },
				});
				await logActivity(tx, created, "Registered a new account", email);
				return created;
			});
		} catch (err) {
			// Two registrations with the same email raced past the lookup above
			if (isPrismaKnownError(err) && err.code === "P2002")
				throw new AppError(httpStatus.CONFLICT, EMAIL_TAKEN, {
					email: EMAIL_TAKEN,
				});
			throw err;
		}
	}

	// Re-registering within the cooldown keeps the code that was already sent
	const wait = await cooldownLeft(user.id, "verify_email");
	if (wait === 0) {
		try {
			await deliverOtp(user, "verify_email", verificationEmail);
		} catch (err) {
			console.error("Verification email failed:", err);
			throw new AppError(
				httpStatus.SERVICE_UNAVAILABLE,
				"We couldn't send the verification email. Please try again in a moment.",
			);
		}
	}
	return {
		message:
			"We've sent a 6-digit code to your email. Enter it to verify your account.",
		email,
		resendAvailableIn: wait || OTP_RESEND_COOLDOWN_SECONDS,
	};
};

// Confirms the sign-up code and signs the user in
const verifyEmail = async (input: Body<"verifyEmail">) => {
	const user = await prisma.user.findUnique({
		where: { email: normaliseEmail(input.email) },
	});
	if (!user) throw invalidCode();
	if (user.emailVerifiedAt)
		throw new AppError(
			httpStatus.CONFLICT,
			"This email is already verified. Please log in.",
		);

	await consumeOtp(user.id, "verify_email", input.code);
	const verified = await prisma.$transaction(async (tx) => {
		// The first account of a new deployment becomes its admin: nobody else is
		// verified (or an admin) yet. The lock makes two first sign-ups take turns,
		// so only one of them can win.
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('first-admin'))`;
		const others = await tx.user.count({
			where: {
				id: { not: user.id },
				OR: [{ emailVerifiedAt: { not: null } }, { role: "admin" }],
			},
		});
		return tx.user.update({
			where: { id: user.id },
			data: {
				emailVerifiedAt: new Date(),
				...(others === 0 ? { role: "admin" as const } : {}),
			},
		});
	});
	if (verified.role === "admin" && user.role !== "admin")
		console.log(`[auth] ${verified.email} is the first account: made admin`);
	if (verified.status === "banned")
		throw new AppError(httpStatus.FORBIDDEN, BANNED_MESSAGE);
	return session(verified);
};

// Runs after the response is sent. Looking the account up and emailing it in
// the background keeps the response time the same whether or not it exists.
const inBackground = (label: string, task: () => Promise<unknown>) => {
	void task().catch((err) => console.error(`${label} failed:`, err));
};

const resendVerification = async (input: Body<"resendVerification">) => {
	const email = normaliseEmail(input.email);
	inBackground("Verification email", async () => {
		const user = await prisma.user.findUnique({ where: { email } });
		if (
			user &&
			!user.emailVerifiedAt &&
			user.status === "active" &&
			(await cooldownLeft(user.id, "verify_email")) === 0
		)
			await deliverOtp(user, "verify_email", verificationEmail);
	});
	return {
		message: VERIFICATION_SENT,
		resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS,
	};
};

const forgotPassword = async (input: Body<"forgotPassword">) => {
	const email = normaliseEmail(input.email);
	inBackground("Password reset email", async () => {
		const user = await prisma.user.findUnique({ where: { email } });
		if (
			user &&
			user.status === "active" &&
			(await cooldownLeft(user.id, "reset_password")) === 0
		)
			await deliverOtp(user, "reset_password", passwordResetEmail);
	});
	return {
		message: RESET_SENT,
		resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS,
	};
};

// Sets a new password from an emailed code. Signs out every existing session
// (tokenVersion) and, since the code proves the email, verifies it as well.
const resetPassword = async (input: Body<"resetPassword">) => {
	const user = await prisma.user.findUnique({
		where: { email: normaliseEmail(input.email) },
	});
	if (!user) throw invalidCode();

	await consumeOtp(user.id, "reset_password", input.code);
	await prisma.user.update({
		where: { id: user.id },
		data: {
			passwordHash: await hashPassword(input.password),
			tokenVersion: { increment: 1 },
			emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
		},
	});
	return { message: "Your password has been reset. You can now log in." };
};

// Used by the passport-local strategy. The password is checked first, so the
// banned / unverified answers are only given to someone who knows it.
const verifyCredentials = async (email: string, password: string) => {
	const user = await prisma.user.findUnique({
		where: { email: normaliseEmail(email) },
	});
	const valid = await verifyPassword(
		password,
		user?.passwordHash ?? DUMMY_PASSWORD_HASH,
	);
	if (!user || !valid)
		throw new AppError(httpStatus.UNAUTHORIZED, "Incorrect email or password.");
	if (user.status === "banned")
		throw new AppError(httpStatus.FORBIDDEN, BANNED_MESSAGE);
	if (!user.emailVerifiedAt)
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Verify your email address to log in. Enter the code we emailed you, or request a new one.",
			undefined,
			"EMAIL_NOT_VERIFIED",
		);
	return user;
};

const getMe = async (user: User) => {
	const teacher = await prisma.teacherProfile.findUnique({
		where: { userId: user.id },
	});
	return {
		user: toUserResponse(user),
		teacher: teacher ? toTeacherProfileResponse(teacher) : null,
	};
};

export const AuthService = {
	register,
	verifyEmail,
	resendVerification,
	forgotPassword,
	resetPassword,
	verifyCredentials,
	session,
	getMe,
};
