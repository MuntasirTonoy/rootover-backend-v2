// "Continue with Google" (POST /api/auth/google). google-auth-library is
// mocked: a credential is "google:" + the base64 JSON payload Google would
// return, and anything else is rejected like a forged or expired token.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { api, prisma, startApp } from "./helpers.js";

vi.mock("google-auth-library", () => ({
	OAuth2Client: class {
		async verifyIdToken({
			idToken,
			audience,
		}: {
			idToken: string;
			audience: string;
		}) {
			if (
				!idToken.startsWith("google:") ||
				audience !== "test-client.apps.googleusercontent.com"
			)
				throw new Error("Invalid token signature");
			const payload = JSON.parse(
				Buffer.from(idToken.slice(7), "base64").toString(),
			);
			return { getPayload: () => payload };
		}
	},
}));

const credential = (payload: object) =>
	`google:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;

const stamp = Date.now();
const emails = {
	fresh: `g-fresh-${stamp}@example.com`,
	pending: `g-pending-${stamp}@example.com`,
	banned: `g-banned-${stamp}@example.com`,
	unverifiedGoogle: `g-unverified-${stamp}@example.com`,
};

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const google = (payload: object | string) =>
	call("/auth/google", {
		method: "POST",
		body: {
			credential: typeof payload === "string" ? payload : credential(payload),
		},
	});

beforeAll(() => {
	app = startApp();
	call = api(app.base);
});

afterAll(async () => {
	const where = { email: { in: Object.values(emails) } };
	const ids = (await prisma.user.findMany({ where, select: { id: true } })).map(
		(u) => u.id,
	);
	await prisma.activityLog.deleteMany({ where: { actorId: { in: ids } } });
	await prisma.emailOtp.deleteMany({ where: { userId: { in: ids } } });
	await prisma.user.deleteMany({ where });
	await app.close();
});

describe("POST /api/auth/google", () => {
	it("creates a verified student on first use and signs the same account in again", async () => {
		const first = await google({
			email: emails.fresh.toUpperCase(),
			email_verified: true,
			name: "Google Student",
		});
		expect(first.status).toBe(200);
		expect(first.body.token).toEqual(expect.any(String));
		expect(first.body.user).toMatchObject({
			email: emails.fresh,
			name: "Google Student",
			role: "student",
		});
		expect(first.body.user.passwordHash).toBeUndefined();

		const row = await prisma.user.findUniqueOrThrow({
			where: { email: emails.fresh },
		});
		expect(row.emailVerifiedAt).not.toBeNull();
		const log = await prisma.activityLog.findFirst({
			where: { actorId: row.id },
		});
		expect(log?.action).toBe("Registered a new account (Google)");

		const again = await google({ email: emails.fresh, email_verified: true });
		expect(again.status).toBe(200);
		expect(again.body.user.id).toBe(row.id);

		// The account works with the API like any other
		const me = await call("/auth/me", { token: again.body.token });
		expect(me.status).toBe(200);
		expect(me.body.user.id).toBe(row.id);
	});

	it("signs an existing email/password account in without touching its password", async () => {
		const before = await prisma.user.findUniqueOrThrow({
			where: { email: "student@rootover.demo" },
		});
		const res = await google({
			email: "student@rootover.demo",
			email_verified: true,
			name: "Someone Else",
		});
		expect(res.status).toBe(200);
		expect(res.body.user.id).toBe(before.id);
		// The existing name is kept
		expect(res.body.user.name).toBe(before.name);
		const after = await prisma.user.findUniqueOrThrow({
			where: { id: before.id },
		});
		expect(after.passwordHash).toBe(before.passwordHash);
		expect(after.tokenVersion).toBe(before.tokenVersion);
	});

	it("finishes an unverified sign-up and drops the password nobody proved", async () => {
		const pending = await prisma.user.create({
			data: {
				name: "Pending Signup",
				email: emails.pending,
				passwordHash: "not-a-real-hash",
			},
		});
		const res = await google({ email: emails.pending, email_verified: true });
		expect(res.status).toBe(200);
		expect(res.body.user.id).toBe(pending.id);
		const after = await prisma.user.findUniqueOrThrow({
			where: { id: pending.id },
		});
		expect(after.emailVerifiedAt).not.toBeNull();
		expect(after.passwordHash).not.toBe("not-a-real-hash");
		expect(after.tokenVersion).toBe(pending.tokenVersion + 1);
		expect(after.role).toBe("student");
	});

	it("refuses suspended accounts, unverified Google emails and bad tokens", async () => {
		await prisma.user.create({
			data: {
				name: "Banned User",
				email: emails.banned,
				passwordHash: "x",
				emailVerifiedAt: new Date(),
				status: "banned",
			},
		});
		const banned = await google({ email: emails.banned, email_verified: true });
		expect(banned.status).toBe(403);
		expect(banned.body.error.message).toMatch(/suspended/);

		const unverified = await google({
			email: emails.unverifiedGoogle,
			email_verified: false,
		});
		expect(unverified.status).toBe(401);
		expect(
			await prisma.user.findUnique({
				where: { email: emails.unverifiedGoogle },
			}),
		).toBeNull();

		const forged = await google("forged-token-that-google-would-reject");
		expect(forged.status).toBe(401);
		expect(forged.body.error.message).toBe(
			"Google sign-in failed. Please try again.",
		);

		const missing = await call("/auth/google", { method: "POST", body: {} });
		expect(missing.status).toBe(400);
	});
});
