// Admin area end to end (spec section 10.7) as the seeded admin. Seeded rows
// that are changed (course status, user status, a withdrawal) are restored,
// and the activity rows this file logged are deleted afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTeacherFinance } from "../../src/app/utils/finance.queries.js";
import { salesTotals } from "../../src/app/utils/finance.js";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const startedAt = new Date();

const admin = (path: string, init: Parameters<typeof call>[1] = {}) =>
	call(path, { ...init, token: tokens["u-admin"] });

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-admin", "u-s1", "u-t1"]) tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.activityLog.deleteMany({
		where: { actorId: "u-admin", at: { gte: startedAt } },
	});
	await app.close();
});

describe("access", () => {
	it("is limited to admins", async () => {
		expect((await call("/admin/overview")).status).toBe(401);
		for (const id of ["u-s1", "u-t1"]) {
			const r = await call("/admin/overview", { token: tokens[id] });
			expect(r.status).toBe(403);
		}
	});
});

describe("overview and reports", () => {
	it("matches the finance functions over the whole database", async () => {
		const purchases = await prisma.purchase.findMany();
		const r = await admin("/admin/overview");
		expect(r.status).toBe(200);
		expect(r.body.totals).toEqual(salesTotals(purchases));
		expect(r.body.monthly).toHaveLength(6);
		expect(r.body.counts.students).toBe(
			await prisma.user.count({ where: { role: "student" } }),
		);
		expect(r.body.pendingCourses.length).toBeLessThanOrEqual(5);
		expect(r.body.recentActivity.length).toBeLessThanOrEqual(8);
		expect(r.body.reports).toEqual({
			open: expect.any(Number),
			awaitingApproval: expect.any(Number),
		});

		const rep = await admin("/admin/reports");
		expect(rep.status).toBe(200);
		expect(rep.body.platformRevenue).toBe(
			rep.body.totals.commission + rep.body.registrationFees.total,
		);
		const levelGross = rep.body.byLevel.reduce(
			(s: number, l: { gross: number }) => s + l.gross,
			0,
		);
		expect(levelGross).toBe(rep.body.totals.gross);
		const t1 = rep.body.byTeacher.find((t: { id: string }) => t.id === "t1");
		expect(t1).toMatchObject(await loadTeacherFinance(prisma, "t1"));
	});
});

describe("courses", () => {
	it("lists pending courses first and filters", async () => {
		const r = await admin("/admin/courses?limit=100");
		expect(r.status).toBe(200);
		const statuses: string[] = r.body.data.map(
			(c: { status: string }) => c.status,
		);
		const firstOther = statuses.findIndex((s) => s !== "pending");
		expect(statuses.slice(firstOther)).not.toContain("pending");
		const hsc = await admin("/admin/courses?level=HSC&status=");
		expect(
			hsc.body.data.every((c: { level: string }) => c.level === "HSC"),
		).toBe(true);
		const bad = await admin("/admin/courses?status=live");
		expect(bad.status).toBe(400);
	});

	it("rejects, approves, suspends and reinstates with the right rules", async () => {
		const id = "c-hsc-highermath";
		const before = await prisma.course.findUniqueOrThrow({ where: { id } });
		expect(before.status).toBe("pending");
		try {
			const detail = await admin(`/admin/courses/${id}`);
			expect(detail.status).toBe(200);
			expect(detail.body.teacher.id).toBe("t1");
			expect(detail.body.chapters[0].lessons[0].videoUrl).toBeTruthy();

			const noReason = await admin(`/admin/courses/${id}/reject`, {
				method: "POST",
				body: {},
			});
			expect(noReason.status).toBe(400);
			const suspendPending = await admin(`/admin/courses/${id}/suspend`, {
				method: "POST",
				body: { reason: "Not allowed from pending" },
			});
			expect(suspendPending.status).toBe(422);

			const rejected = await admin(`/admin/courses/${id}/reject`, {
				method: "POST",
				body: { reason: "Please add more lessons." },
			});
			expect(rejected.body).toMatchObject({
				status: "rejected",
				statusNote: "Please add more lessons.",
			});
			const approveRejected = await admin(`/admin/courses/${id}/approve`, {
				method: "POST",
			});
			expect(approveRejected.status).toBe(422);

			await prisma.course.update({ where: { id }, data: { status: "pending" } });
			const approved = await admin(`/admin/courses/${id}/approve`, {
				method: "POST",
			});
			expect(approved.body.status).toBe("approved");
			expect(approved.body.statusNote).toBeUndefined();
			const suspended = await admin(`/admin/courses/${id}/suspend`, {
				method: "POST",
				body: { reason: "Copyright complaint" },
			});
			expect(suspended.body.status).toBe("suspended");
			const reinstated = await admin(`/admin/courses/${id}/approve`, {
				method: "POST",
			});
			expect(reinstated.body.status).toBe("approved");

			const logs = await prisma.activityLog.findMany({
				where: { actorId: "u-admin", at: { gte: startedAt }, target: before.title },
			});
			expect(logs.map((l) => l.action).sort()).toEqual([
				"Approved course",
				"Approved course",
				"Rejected course",
				"Suspended course",
			]);
			expect((await admin("/admin/courses/nope/approve", { method: "POST" })).status).toBe(404);
		} finally {
			await prisma.course.update({
				where: { id },
				data: {
					status: before.status,
					statusNote: before.statusNote,
					updatedAt: before.updatedAt,
				},
			});
		}
	});
});

describe("people", () => {
	it("lists teachers with balances and students with spending", async () => {
		const t = await admin("/admin/teachers?q=RO-T");
		expect(t.status).toBe(200);
		const t1 = t.body.data.find((r: { id: string }) => r.id === "t1");
		const finance = await loadTeacherFinance(prisma, "t1");
		expect(t1).toMatchObject({
			net: finance.teacherNet,
			withdrawable: finance.withdrawable,
		});
		const s = await admin("/admin/students?limit=100");
		expect(s.body.pagination.total).toBe(
			await prisma.user.count({ where: { role: "student" } }),
		);
		const s1 = s.body.data.find((r: { id: string }) => r.id === "u-s1");
		const bought = await prisma.purchase.findMany({ where: { studentId: "u-s1" } });
		expect(s1.totalSpent).toBe(salesTotals(bought).gross);
		expect(s1).not.toHaveProperty("passwordHash");
	});

	it("bans and unbans, never admins or yourself", async () => {
		try {
			const ban = await admin("/admin/users/u-t1/status", {
				method: "PATCH",
				body: { status: "banned" },
			});
			expect(ban.body.status).toBe("banned");
			// The banned teacher is locked out and their courses leave the catalog
			expect((await call("/teacher/me", { token: tokens["u-t1"] })).status).toBe(403);
			const catalog = await call("/courses?limit=100");
			expect(
				catalog.body.data.some((c: { teacher: { id: string } }) => c.teacher.id === "t1"),
			).toBe(false);
			const unban = await admin("/admin/users/u-t1/status", {
				method: "PATCH",
				body: { status: "active" },
			});
			expect(unban.body.status).toBe("active");

			const self = await admin("/admin/users/u-admin/status", {
				method: "PATCH",
				body: { status: "banned" },
			});
			expect(self.status).toBe(422);
		} finally {
			await prisma.user.update({ where: { id: "u-t1" }, data: { status: "active" } });
		}
	});
});

describe("money", () => {
	it("lists registration fees and filtered transactions with totals", async () => {
		const fees = await admin("/admin/registration-fees");
		expect(fees.status).toBe(200);
		expect(fees.body.totals.count).toBe(await prisma.registrationFee.count());
		expect(fees.body.data[0].applicant.fullName).toBeTruthy();

		const tx = await admin("/admin/transactions?status=refunded");
		expect(tx.status).toBe(200);
		const refunded = await prisma.purchase.findMany({ where: { status: "refunded" } });
		expect(tx.body.pagination.total).toBe(refunded.length);
		expect(tx.body.totals).toEqual(salesTotals(refunded));
		if (tx.body.data[0]) {
			const one = await admin(`/admin/transactions/${tx.body.data[0].id}`);
			expect(one.body.trxId).toBe(tx.body.data[0].trxId);
		}
	});

	it("processes a pending withdrawal once", async () => {
		const created = await prisma.withdrawal.create({
			data: { teacherId: "t1", amount: 500, accountNumber: "01700000000" },
		});
		try {
			const list = await admin("/admin/withdrawals");
			expect(
				list.body.data.every((w: { status: string }) => w.status === "pending"),
			).toBe(true);
			expect(list.body.sums.pending.count).toBeGreaterThan(0);
			const all = await admin("/admin/withdrawals?status=&limit=100");
			expect(all.body.pagination.total).toBe(await prisma.withdrawal.count());

			const before = await loadTeacherFinance(prisma, "t1");
			const rejected = await admin(`/admin/withdrawals/${created.id}/reject`, {
				method: "POST",
				body: { reason: "Wrong bKash number" },
			});
			expect(rejected.body).toMatchObject({
				status: "rejected",
				note: "Wrong bKash number",
				withdrawable: before.withdrawable + 500,
			});
			const again = await admin(`/admin/withdrawals/${created.id}/approve`, {
				method: "POST",
			});
			expect(again.status).toBe(422);
		} finally {
			await prisma.withdrawal.delete({ where: { id: created.id } });
		}
	});
});

describe("activity log", () => {
	it("filters by role and pages 15 at a time", async () => {
		const r = await admin("/admin/activity-logs?role=admin");
		expect(r.status).toBe(200);
		expect(r.body.pagination.limit).toBe(15);
		expect(
			r.body.data.every((l: { actorRole: string }) => l.actorRole === "admin"),
		).toBe(true);
	});
});

describe("admin roles", () => {
	it("an admin makes a student an admin and removes the role again", async () => {
		const u = await prisma.user.create({
			data: {
				name: "Role Test",
				email: `role-${Date.now().toString(36)}@admin-db.test`,
				passwordHash: "!",
				emailVerifiedAt: new Date(),
			},
		});
		try {
			const oldToken = await tokenFor(u.id);
			const role = (id: string, value: string, token = tokens["u-admin"]) =>
				call(`/admin/users/${id}/role`, {
					method: "PATCH",
					token,
					body: { role: value },
				});

			const promoted = await role(u.id, "admin");
			expect(promoted.status).toBe(200);
			expect(promoted.body.role).toBe("admin");
			// The old token carried the student role: it no longer works
			expect((await call("/auth/me", { token: oldToken })).status).toBe(401);
			const admins = await call("/admin/admins", { token: tokens["u-admin"] });
			expect(admins.body.map((a: { id: string }) => a.id)).toContain(u.id);

			// The new admin can't ban or demote... themselves; others can't be
			// banned while they're admins
			const newToken = await tokenFor(u.id);
			expect((await role(u.id, "student", newToken)).status).toBe(422);
			const ban = await call(`/admin/users/${u.id}/status`, {
				method: "PATCH",
				token: tokens["u-admin"],
				body: { status: "banned" },
			});
			expect(ban.status).toBe(422);

			const demoted = await role(u.id, "student");
			expect(demoted.body.role).toBe("student");
			expect(
				(await call("/admin/overview", { token: newToken })).status,
			).toBe(401);

			// Teachers and unknown users can't be made admins; nor can you change yourself
			expect((await role("u-t1", "admin")).status).toBe(422);
			expect((await role("nobody", "admin")).status).toBe(404);
			expect((await role("u-admin", "student")).status).toBe(422);
			expect((await role(u.id, "owner")).status).toBe(400);

			const logs = await prisma.activityLog.findMany({
				where: { target: "Role Test", at: { gte: startedAt } },
			});
			expect(logs.map((l) => l.action).sort()).toEqual([
				"Made user an admin",
				"Removed admin role",
			]);
		} finally {
			await prisma.user.delete({ where: { id: u.id } });
		}
	});
});
