// Acceptance tests (BACKEND_SPEC section 19). Where each one lives:
//   1-3  quote maths ..................... tests/unit/pricing.test.ts
//   4-6  money invariants ................ tests/unit/seed-money.test.ts, tests/db/finance.db.test.ts
//   7    coupon checks ................... tests/unit/pricing.test.ts (checkCoupon)
//   8    locked lessons .................. tests/db/catalog.db.test.ts
//   9    checkout roles / buying twice ... tests/db/student.db.test.ts
//   10   application workflow ............ tests/db/application.db.test.ts
//   11   course workflow ................. here
//   12   withdrawals ..................... tests/db/teacher.db.test.ts (above balance),
//                                          tests/unit/finance.test.ts + tests/db/admin.db.test.ts (rejected)
//   13   video reports ................... tests/db/report.db.test.ts
//   14   banned user ..................... here
// The course created here is deleted afterwards and u-t1 is always unbanned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/app/modules/auth/auth.utils.js";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const tag = Date.now().toString(36);
const startedAt = new Date();
const createdCourses: string[] = [];
const testUsers: string[] = [];

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-t1", "u-admin"]) tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.user.update({
		where: { id: "u-t1" },
		data: { status: "active" },
	});
	await prisma.course.deleteMany({ where: { id: { in: createdCourses } } });
	await prisma.activityLog.deleteMany({
		where: {
			at: { gte: startedAt },
			actorId: { in: ["u-t1", "u-admin", ...testUsers] },
		},
	});
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
	await app.close();
});

const inCatalog = async (title: string) => {
	const r = await call(`/courses?q=${encodeURIComponent(title)}&limit=50`);
	return r.body.data.some((c: { title: string }) => c.title === title);
};

describe("spec test 11: course workflow", () => {
	it("draft -> submit (validated) -> approve -> listed; banning the teacher hides it", async () => {
		const t1 = (path: string, method: string, body?: unknown) =>
			call(path, { method, token: tokens["u-t1"], body });
		const title = `Acceptance course ${tag}`;

		// A draft needs only a title...
		const draft = await t1("/teacher/courses", "POST", {
			level: "SSC",
			title,
			price: 900,
		});
		expect(draft.status).toBe(201);
		expect(draft.body.status).toBe("draft");
		createdCourses.push(draft.body.id);
		const id = draft.body.id;

		// ...but submitting runs the full validation
		const incomplete = await t1(`/teacher/courses/${id}/submit`, "POST");
		expect(incomplete.status).toBe(400);
		expect(Object.keys(incomplete.body.error.fields).length).toBeGreaterThan(0);

		const saved = await t1(`/teacher/courses/${id}`, "PUT", {
			level: "SSC",
			subject: "Physics",
			title,
			description:
				"Everything a complete course needs, for the acceptance test.",
			outcomes: ["Pass the acceptance test"],
			price: 900,
			chapters: [
				{
					title: "Chapter one",
					lessons: [
						{
							title: "Lesson one",
							durationMin: 10,
							videoUrl: "https://youtu.be/dQw4w9WgXcQ",
							isPreview: true,
						},
					],
				},
			],
		});
		expect(saved.status).toBe(200);
		const submitted = await t1(`/teacher/courses/${id}/submit`, "POST");
		expect(submitted.body.status).toBe("pending");
		expect(await inCatalog(title)).toBe(false);

		const approved = await call(`/admin/courses/${id}/approve`, {
			method: "POST",
			token: tokens["u-admin"],
		});
		expect(approved.body.status).toBe("approved");
		expect(await inCatalog(title)).toBe(true);

		await call("/admin/users/u-t1/status", {
			method: "PATCH",
			token: tokens["u-admin"],
			body: { status: "banned" },
		});
		expect(await inCatalog(title)).toBe(false);
		expect((await call(`/courses/${id}`)).status).toBe(404);

		await call("/admin/users/u-t1/status", {
			method: "PATCH",
			token: tokens["u-admin"],
			body: { status: "active" },
		});
		expect(await inCatalog(title)).toBe(true);
	});
});

describe("spec test 14: banned users", () => {
	it("can't log in, and their existing tokens stop working", async () => {
		const password = "Accept@1234";
		const user = await prisma.user.create({
			data: {
				name: `Banned ${tag}`,
				email: `banned-${tag}@acceptance-db.test`,
				passwordHash: await hashPassword(password),
				emailVerifiedAt: new Date(),
			},
		});
		testUsers.push(user.id);
		const login = () =>
			call("/auth/login", {
				method: "POST",
				body: { email: user.email, password },
			});

		const before = await login();
		expect(before.status).toBe(200);
		const token = before.body.token;
		expect((await call("/auth/me", { token })).status).toBe(200);

		const ban = await call(`/admin/users/${user.id}/status`, {
			method: "PATCH",
			token: tokens["u-admin"],
			body: { status: "banned" },
		});
		expect(ban.body.status).toBe("banned");

		const after = await login();
		expect(after.status).toBe(403);
		expect(after.body.error.message).toBe(
			"This account has been suspended by an administrator.",
		);
		const me = await call("/auth/me", { token });
		expect(me.status).toBe(403);
		expect(me.body.error.message).toBe(
			"This account has been suspended by an administrator.",
		);
	});
});
