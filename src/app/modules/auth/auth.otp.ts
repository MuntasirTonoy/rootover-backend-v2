import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import httpStatus from "http-status";
import type { OtpPurpose, User } from "../../../generated/prisma/client.js";
import config from "../../../config/index.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const INVALID_CODE = "The code is invalid or has expired.";

// Only an HMAC of the code is stored, keyed with a server secret, so a leaked
// table can't be turned back into codes without that secret
const hashCode = (code: string) =>
	createHmac("sha256", `otp:${config.jwt.access_secret}`)
		.update(code)
		.digest("hex");

const sameHash = (a: string, b: string) =>
	a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Seconds until another code may be sent for this purpose (0 = now)
export const cooldownLeft = async (userId: string, purpose: OtpPurpose) => {
	const last = await prisma.emailOtp.findFirst({
		where: { userId, purpose },
		orderBy: { createdAt: "desc" },
	});
	if (!last) return 0;
	const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
	return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
};

// Creates a fresh 6-digit code and consumes any earlier unused ones
export const issueOtp = async (user: User, purpose: OtpPurpose) => {
	const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
	const [, created] = await prisma.$transaction([
		prisma.emailOtp.updateMany({
			where: { userId: user.id, purpose, consumedAt: null },
			data: { consumedAt: new Date() },
		}),
		prisma.emailOtp.create({
			data: {
				userId: user.id,
				purpose,
				codeHash: hashCode(code),
				expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
			},
		}),
	]);
	return { id: created.id, code };
};

// Checks the latest live code and consumes it on success. Every wrong guess
// counts; after OTP_MAX_ATTEMPTS the code is burnt and a new one is needed.
export const consumeOtp = async (
	userId: string,
	purpose: OtpPurpose,
	code: string,
) => {
	const otp = await prisma.emailOtp.findFirst({
		where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
		orderBy: { createdAt: "desc" },
	});
	if (!otp)
		throw new AppError(httpStatus.BAD_REQUEST, INVALID_CODE, {
			code: INVALID_CODE,
		});

	if (!sameHash(hashCode(code), otp.codeHash)) {
		// Conditional increment so concurrent guesses can't exceed the limit
		const { count } = await prisma.emailOtp.updateMany({
			where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS - 1 } },
			data: { attempts: { increment: 1 } },
		});
		if (count === 0) {
			await prisma.emailOtp.update({
				where: { id: otp.id },
				data: { attempts: OTP_MAX_ATTEMPTS, consumedAt: new Date() },
			});
			const message = "Too many wrong attempts. Request a new code.";
			throw new AppError(httpStatus.BAD_REQUEST, message, { code: message });
		}
		throw new AppError(httpStatus.BAD_REQUEST, INVALID_CODE, {
			code: INVALID_CODE,
		});
	}

	// Single use: only one concurrent request can claim the code
	const { count } = await prisma.emailOtp.updateMany({
		where: { id: otp.id, consumedAt: null },
		data: { consumedAt: new Date() },
	});
	if (count === 0)
		throw new AppError(httpStatus.BAD_REQUEST, INVALID_CODE, {
			code: INVALID_CODE,
		});
};
