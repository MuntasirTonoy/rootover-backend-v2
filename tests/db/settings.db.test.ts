// Admin-editable platform fees (commission + registration fee) confirmed by an
// emailed code, and the email an applicant gets when the fee is requested.
// The mailer is mocked so the test can read the codes. Everything touched is
// restored afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mail } from "../../src/app/lib/mailer.js";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("../../src/app/lib/mailer.js", () => ({
	mailerMode: () => "console",
	sendMail: async (mail: Mail) => {
		sent.push(mail);
	},
}));

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
let admin: string;
let adminEmail: string;
let teacher: string;
let original: Awaited<ReturnType<typeof prisma.platformSettings.findUnique>>;
let pendingApp: { id: string; userId: string } | null = null;
const startedAt = new Date();

const codeFrom = (to: string) =>
	sent
		.filter((m) => m.to === to)
		.at(-1)
		?.text.match(/\b(\d{6})\b/)?.[1] ?? "";

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	admin = await tokenFor("u-admin");
	teacher = await tokenFor("u-t1");
	adminEmail = (
		await prisma.user.findUniqueOrThrow({ where: { id: "u-admin" } })
	).email;
	original = await prisma.platformSettings.findUnique({
		where: { id: "default" },
	});
	await prisma.emailOtp.deleteMany({
		where: { userId: "u-admin", purpose: "admin_settings" },
	});
	pendingApp = await prisma.teacherApplication.findFirst({
		where: { status: "pending_review" },
		select: { id: true, userId: true },
	});
});

afterAll(async () => {
	if (original)
		await prisma.platformSettings.update({
			where: { id: "default" },
			data: {
				commissionRate: original.commissionRate,
				registrationFee: original.registrationFee,
				updatedById: original.updatedById,
			},
		});
	else await prisma.platformSettings.deleteMany({});
	await prisma.emailOtp.deleteMany({
		where: { userId: "u-admin", purpose: "admin_settings" },
	});
	if (pendingApp)
		await prisma.teacherApplication.update({
			where: { id: pendingApp.id },
			data: { status: "pending_review" },
		});
	await prisma.activityLog.deleteMany({
		where: {
			actorId: "u-admin",
			action: {
				in: ["Changed platform settings", "Requested registration fee"],
			},
			at: { gte: startedAt },
		},
	});
	await app.close();
});

describe("platform settings", () => {
	it("are admin-only", async () => {
		expect((await call("/admin/settings", { token: teacher })).status).toBe(
			403,
		);
	});

	it("rejects invalid values and no-op changes", async () => {
		const bad = await call("/admin/settings/code", {
			method: "POST",
			token: admin,
			body: { commissionPercent: 60, registrationFee: 1.5 },
		});
		expect(bad.status).toBe(400);
		expect(Object.keys(bad.body.error.fields).sort()).toEqual([
			"commissionPercent",
			"registrationFee",
		]);

		const current = (await call("/admin/settings", { token: admin })).body;
		const same = await call("/admin/settings/code", {
			method: "POST",
			token: admin,
			body: {
				commissionPercent: current.commissionPercent,
				registrationFee: current.registrationFee,
			},
		});
		expect(same.status).toBe(422);
	});

	it("saves a change only with the code emailed to the admin", async () => {
		const change = { commissionPercent: 12.5, registrationFee: 400 };
		const requested = await call("/admin/settings/code", {
			method: "POST",
			token: admin,
			body: change,
		});
		expect(requested.status).toBe(200);
		expect(requested.body).toMatchObject({
			email: adminEmail,
			resendAvailableIn: 60,
		});
		const mail = sent.findLast((m) => m.to === adminEmail);
		expect(mail?.html).toContain("12.5%");
		expect(mail?.html).toContain("৳400");
		const code = codeFrom(adminEmail);
		expect(code).toMatch(/^\d{6}$/);

		// A second request inside the cooldown is refused
		expect(
			(
				await call("/admin/settings/code", {
					method: "POST",
					token: admin,
					body: change,
				})
			).status,
		).toBe(429);

		const wrong = await call("/admin/settings", {
			method: "PUT",
			token: admin,
			body: { ...change, code: code === "000000" ? "111111" : "000000" },
		});
		expect(wrong.status).toBe(400);

		const saved = await call("/admin/settings", {
			method: "PUT",
			token: admin,
			body: { ...change, code },
		});
		expect(saved.status).toBe(200);
		expect(saved.body).toMatchObject({
			commissionPercent: 12.5,
			registrationFee: 400,
		});
		// Single use
		expect(
			(
				await call("/admin/settings", {
					method: "PUT",
					token: admin,
					body: { ...change, code },
				})
			).status,
		).toBe(400);

		// The new values are live
		const config = (await call("/config")).body;
		expect(config).toMatchObject({
			commissionRate: 0.125,
			registrationFee: 400,
		});
		const preview = await call("/teacher/price-preview?price=1000", {
			token: teacher,
		});
		expect(preview.body).toMatchObject({ commission: 125, teacherNet: 875 });
		expect(
			await prisma.activityLog.count({
				where: {
					actorId: "u-admin",
					action: "Changed platform settings",
					at: { gte: startedAt },
				},
			}),
		).toBe(1);
	});
});

describe("registration fee request", () => {
	it("emails the applicant the current fee and a link to pay", async () => {
		if (!pendingApp) return; // the seed always has one, but don't fail on data
		const applicant = await prisma.user.findUniqueOrThrow({
			where: { id: pendingApp.userId },
		});
		const r = await call(
			`/admin/teacher-applications/${pendingApp.id}/request-payment`,
			{ method: "POST", token: admin },
		);
		expect(r.status).toBe(200);
		const mail = sent.findLast((m) => m.to === applicant.email);
		expect(mail?.subject).toContain("registration fee");
		// The fee set in the previous test
		expect(mail?.html).toContain("৳400");
		expect(mail?.html).toContain("/teacher/apply");
		expect(mail?.text).toContain("approved automatically");
	});
});
