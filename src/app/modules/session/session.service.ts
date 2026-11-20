import { randomUUID } from "node:crypto";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import type { Prisma, User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { signAccessToken } from "../auth/auth.utils.js";
import { describeDevice, toDeviceResponse } from "./session.utils.js";

type Db = Prisma.TransactionClient | typeof prisma;

// Signed-in devices (user's request, 2026-11-20). Every access token belongs
// to a LoginSession row (its `sid`); deleting the row signs that device out.
// Students may be signed in on at most this many devices at once; teachers
// and admins have no limit.
export const MAX_STUDENT_DEVICES = 2;

export const deviceLimitOf = (user: Pick<User, "role">) =>
	user.role === "student" ? MAX_STUDENT_DEVICES : null;

// Where a login comes from; replaceSessionId is the device the user chose to
// sign out when they were at the limit
export interface SessionContext {
	userAgent?: string;
	ip?: string;
	replaceSessionId?: string;
}

const DEVICE_LIMIT_MESSAGE = `You're already logged in on ${MAX_STUDENT_DEVICES} devices. Log out of one of them to continue.`;

// lastSeenAt is refreshed at most this often, so requests don't all write
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const tokenExpiry = (token: string) =>
	new Date((jwt.decode(token) as { exp: number }).exp * 1000);

// Writes the row and signs its token, without the device limit (startSession
// checks that first; tests call this directly so they never hit the limit)
export const openSession = async (
	db: Db,
	user: User,
	ctx: SessionContext = {},
) => {
	const id = randomUUID();
	const token = signAccessToken(user, id);
	await db.loginSession.create({
		data: {
			id,
			userId: user.id,
			...describeDevice(ctx.userAgent),
			ip: ctx.ip?.slice(0, 64) || null,
			userAgent: ctx.userAgent?.slice(0, 512) || null,
			expiresAt: tokenExpiry(token),
		},
	});
	return { id, token };
};

// Every login (password, Google, email code) goes through here. A student
// already on MAX_STUDENT_DEVICES devices gets 409 DEVICE_LIMIT with the list of
// devices; repeating the login with one of their ids as replaceSessionId signs
// that device out and lets the new one in. The per-user lock stops two logins
// at once from both squeezing under the limit.
const startSession = (user: User, ctx: SessionContext) =>
	prisma.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sessions:${user.id}`}))`;
		await tx.loginSession.deleteMany({
			where: { userId: user.id, expiresAt: { lte: new Date() } },
		});

		const limit = deviceLimitOf(user);
		if (limit) {
			const active = await tx.loginSession.findMany({
				where: { userId: user.id },
				orderBy: { lastSeenAt: "desc" },
			});
			if (active.length >= limit) {
				const replace = ctx.replaceSessionId;
				if (!replace || !active.some((s) => s.id === replace))
					throw new AppError(
						httpStatus.CONFLICT,
						DEVICE_LIMIT_MESSAGE,
						undefined,
						"DEVICE_LIMIT",
						{ limit, devices: active.map((s) => toDeviceResponse(s)) },
					);
				// The chosen device goes, and so does anything beyond the limit
				// (e.g. a former admin), least recently used first
				const keep = active
					.filter((s) => s.id !== replace)
					.slice(0, limit - 1)
					.map((s) => s.id);
				await tx.loginSession.deleteMany({
					where: { userId: user.id, id: { notIn: keep } },
				});
			}
		}
		return openSession(tx, user, ctx);
	});

// Looks up the device behind a token (lib/passport.ts) and notes that it was
// seen. Expired rows count as signed out.
const findActive = async (sessionId: string) => {
	const session = await prisma.loginSession.findUnique({
		where: { id: sessionId },
		include: { user: true },
	});
	if (!session || session.expiresAt <= new Date()) return null;
	if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS)
		void prisma.loginSession
			.updateMany({
				where: { id: sessionId },
				data: { lastSeenAt: new Date() },
			})
			.catch(() => undefined);
	return session;
};

// A fresh token for the same device, after tokenVersion changed (password change)
const reissueToken = async (user: User, sessionId: string) => {
	const token = signAccessToken(user, sessionId);
	await prisma.loginSession.updateMany({
		where: { id: sessionId, userId: user.id },
		data: { expiresAt: tokenExpiry(token) },
	});
	return token;
};

// Signs out every device of the account, or every other one
const endAll = (db: Db, userId: string, exceptId?: string) =>
	db.loginSession.deleteMany({
		where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
	});

// POST /api/auth/logout
const end = async (sessionId: string | undefined) => {
	if (sessionId)
		await prisma.loginSession.deleteMany({ where: { id: sessionId } });
};

// GET /api/me/sessions: this device first, then the most recently used
const list = async (user: User, currentId: string | undefined) => {
	const sessions = await prisma.loginSession.findMany({
		where: { userId: user.id, expiresAt: { gt: new Date() } },
		orderBy: { lastSeenAt: "desc" },
	});
	const devices = sessions
		.map((s) => toDeviceResponse(s, currentId))
		.sort((a, b) => Number(b.current) - Number(a.current));
	return { limit: deviceLimitOf(user), devices };
};

// DELETE /api/me/sessions/:id (any of the user's own devices, this one included)
const revoke = async (user: User, sessionId: string) => {
	const { count } = await prisma.loginSession.deleteMany({
		where: { id: sessionId, userId: user.id },
	});
	if (!count)
		throw new AppError(
			httpStatus.NOT_FOUND,
			"This device is already logged out.",
		);
};

// DELETE /api/me/sessions: every device, or with `others` all but this one
const revokeAll = async (
	user: User,
	currentId: string | undefined,
	others: boolean,
) => {
	const { count } = await endAll(
		prisma,
		user.id,
		others ? currentId : undefined,
	);
	return { loggedOut: count };
};

export const SessionService = {
	startSession,
	findActive,
	reissueToken,
	endAll,
	end,
	list,
	revoke,
	revokeAll,
};
