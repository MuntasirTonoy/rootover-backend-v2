// Teacher area end to end (spec section 10.6) as seeded teacher t1 (u-t1).
// Courses, coupons and withdrawals created here are deleted afterwards, along
// with the activity rows they logged; seeded rows that are edited are restored.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTeacherFinance } from "../../src/app/utils/finance.queries.js";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const tag = Date.now().toString(36).toUpperCase();
const startedAt = new Date();
const createdCourses: string[] = [];
const createdCoupons: string[] = [];
const createdWithdrawals: string[] = [];

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const EMBED = "https://www.youtube.com/embed/dQw4w9WgXcQ";
const EMBED2 = "https://www.youtube.com/embed/9bZkp7q19f0";

const t1 = (path: string, init: Parameters<typeof call>[1] = {}) =>
	call(path, { ...init, token: tokens["u-t1"] });

const completeBody = (title: string) => ({
	level: "SSC",
	subject: "Physics",
	title,
	description: "A complete test course with every required field filled in.",
	outcomes: ["Understand motion", ""],
	price: 1200,
	discountPrice: 1000,
	chapters: [
		{
			id: "client-ch-1",
			title: "Motion",
			lessons: [
				{
					id: "client-l-1",
					title: "Speed",
					durationMin: 10,
					videoUrl: WATCH,
					isPreview: true,
				},
				{
					title: "Velocity",
					durationMin: 12,
					videoUrl: `<iframe src="${EMBED2}"></iframe>`,
					noteLink: "https://example.com/notes.pdf",
				},
			],
		},
		{
			title: "Force",
			lessons: [{ title: "Newton", durationMin: 8, videoUrl: EMBED }],
		},
	],
});

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-t1", "u-t2", "u-s1", "u-admin"])
		tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.withdrawal.deleteMany({
		where: { id: { in: createdWithdrawals } },
	});
	await prisma.coupon.deleteMany({ where: { id: { in: createdCoupons } } });
	await prisma.course.deleteMany({ where: { id: { in: createdCourses } } });
	await prisma.activityLog.deleteMany({
		where: { actorId: "u-t1", at: { gte: startedAt } },
	});
	await app.close();
});

describe("access", () => {
	it("is limited to teachers", async () => {
		expect((await call("/teacher/me")).status).toBe(401);
		const student = await call("/teacher/dashboard", { token: tokens["u-s1"] });
		expect(student.status).toBe(403);
		const admin = await call("/teacher/courses", { token: tokens["u-admin"] });
		expect(admin.status).toBe(403);
	});
});

describe("profile", () => {
	it("returns the public profile and a masked application", async () => {
		const r = await t1("/teacher/me");
		expect(r.status).toBe(200);
		expect(r.body.teacher).toMatchObject({ id: "t1", userId: "u-t1" });
		expect(r.body.teacher.stats.courses).toBeGreaterThan(0);
		if (r.body.application) {
			expect(r.body.application.nid).toContain("•");
			expect(r.body.application.bkashNumber).toContain("•");
		}
	});

	it("updates the editable fields", async () => {
		const before = await prisma.teacherProfile.findUniqueOrThrow({
			where: { id: "t1" },
		});
		try {
			const r = await t1("/teacher/me", {
				method: "PATCH",
				body: {
					headline: "  ",
					qualifications: ["MSc", " ", "BSc "],
					experienceYears: 13,
				},
			});
			expect(r.status).toBe(200);
			expect(r.body).toMatchObject({
				headline: "Teacher on Root Over",
				qualifications: ["MSc", "BSc"],
				experienceYears: 13,
				bio: before.bio,
			});
			const bad = await t1("/teacher/me", {
				method: "PATCH",
				body: { experienceYears: -1 },
			});
			expect(bad.status).toBe(400);
		} finally {
			const {
				id: _id,
				userId: _u,
				teacherCode: _c,
				joinedAt: _j,
				...fields
			} = before;
			await prisma.teacherProfile.update({ where: { id: "t1" }, data: fields });
		}
	});
});

describe("dashboard, students, earnings", () => {
	it("dashboard numbers agree with the database", async () => {
		const r = await t1("/teacher/dashboard");
		expect(r.status).toBe(200);
		const courses = await prisma.course.findMany({
			where: { teacherId: "t1" },
		});
		expect(r.body.counts.total).toBe(courses.length);
		expect(r.body.counts.draft).toBe(
			courses.filter((c) => c.status === "draft").length,
		);
		expect(r.body.finance).toEqual(await loadTeacherFinance(prisma, "t1"));
		expect(r.body.monthly).toHaveLength(6);
		expect(r.body.recentEnrollments.length).toBeLessThanOrEqual(6);
		expect(
			r.body.coursePerformance.every(
				(c: { status: string }) => c.status !== "draft",
			),
		).toBe(true);
		expect(r.body.reports).toEqual({
			needsFix: expect.any(Number),
			awaitingAdmin: expect.any(Number),
		});
	});

	it("students: paginated, filtered, with stats over the filtered rows", async () => {
		const total = await prisma.enrollment.count({
			where: { course: { teacherId: "t1" } },
		});
		const r = await t1("/teacher/students?limit=2");
		expect(r.status).toBe(200);
		expect(r.body.pagination).toMatchObject({ page: 1, limit: 2, total });
		expect(r.body.data.length).toBeLessThanOrEqual(2);
		expect(r.body.stats.enrollments).toBe(total);
		const row = r.body.data[0];
		expect(row).toHaveProperty("enrollment.completedLessonIds");
		expect(row).toHaveProperty("progress.percent");
		expect(row.student).toHaveProperty("email");

		const one = await t1("/teacher/students?courseId=c-ssc-physics");
		const physics = await prisma.enrollment.count({
			where: { courseId: "c-ssc-physics" },
		});
		expect(one.body.stats.enrollments).toBe(physics);
		// Another teacher's course gives nothing, never their students
		const foreign = await t1("/teacher/students?courseId=c-hsc-chemistry");
		expect(foreign.body.pagination.total).toBe(0);
	});

	it("earnings: finance for everything, transactions filtered by course", async () => {
		const all = await t1("/teacher/earnings");
		const count = await prisma.purchase.count({ where: { teacherId: "t1" } });
		expect(all.body.transactions.pagination.total).toBe(count);
		expect(all.body.transactions.data[0]).toHaveProperty("student.email");
		const one = await t1("/teacher/earnings?courseId=c-ssc-physics");
		expect(one.body.finance).toEqual(all.body.finance);
		expect(
			one.body.transactions.data.every(
				(p: { courseId: string }) => p.courseId === "c-ssc-physics",
			),
		).toBe(true);
	});
});

describe("courses", () => {
	let id: string;

	it("creates a draft with only a title, ignoring client ids", async () => {
		const r = await t1("/teacher/courses", {
			method: "POST",
			body: {
				level: "SSC",
				title: `Draft ${tag}`,
				price: 0,
				chapters: [{ lessons: [{ durationMin: 0, videoUrl: "not a link" }] }],
			},
		});
		expect(r.status).toBe(201);
		createdCourses.push(r.body.id);
		expect(r.body).toMatchObject({ status: "draft", teacherId: "t1" });
		// Invalid links are kept as typed while drafting
		expect(r.body.chapters[0].lessons[0].videoUrl).toBe("not a link");

		const bad = await t1("/teacher/courses", {
			method: "POST",
			body: { level: "SSC", title: "Abc", price: 0 },
		});
		expect(bad.status).toBe(400);
		expect(bad.body.error.fields.title).toBe(
			"Give the course a title of at least 5 characters.",
		);
	});

	it("creates, normalises links and keeps ids stable across saves", async () => {
		const r = await t1("/teacher/courses", {
			method: "POST",
			body: completeBody(`Course ${tag}`),
		});
		expect(r.status).toBe(201);
		id = r.body.id;
		createdCourses.push(id);
		const [motion, force] = r.body.chapters;
		expect(motion.id).not.toBe("client-ch-1");
		expect(motion.lessons.map((l: { videoUrl: string }) => l.videoUrl)).toEqual(
			[EMBED, EMBED2],
		);
		expect(r.body.outcomes).toEqual(["Understand motion"]);

		// Reorder chapters, move "Velocity" into Force, drop "Speed", add a lesson
		const [speed, velocity] = motion.lessons;
		const put = await t1(`/teacher/courses/${id}`, {
			method: "PUT",
			body: {
				...completeBody(`Course ${tag} v2`),
				chapters: [
					{
						id: force.id,
						title: "Force!",
						lessons: [velocity, ...force.lessons],
					},
					{
						id: motion.id,
						title: "Motion",
						lessons: [
							{ title: "Acceleration", durationMin: 9, videoUrl: WATCH },
						],
					},
				],
			},
		});
		expect(put.status).toBe(200);
		expect(put.body.title).toBe(`Course ${tag} v2`);
		expect(put.body.chapters.map((c: { id: string }) => c.id)).toEqual([
			force.id,
			motion.id,
		]);
		expect(
			put.body.chapters[0].lessons.map((l: { id: string }) => l.id),
		).toEqual([velocity.id, force.lessons[0].id]);
		expect(await prisma.lesson.count({ where: { id: speed.id } })).toBe(0);
		expect(put.body.chapters[1].lessons[0].id).not.toBe(speed.id);
		expect(put.body.status).toBe("draft");
	});

	it("lists and reads only the teacher's own courses", async () => {
		const list = await t1(`/teacher/courses?q=${tag}`);
		expect(list.body.map((c: { id: string }) => c.id)).toContain(id);
		const row = list.body.find((c: { id: string }) => c.id === id);
		expect(row).toMatchObject({ chapters: 2, lessons: 3, students: 0, net: 0 });

		expect((await t1(`/teacher/courses/${id}`)).status).toBe(200);
		const other = await call(`/teacher/courses/${id}`, {
			token: tokens["u-t2"],
		});
		expect(other.status).toBe(404);
		const otherPut = await call(`/teacher/courses/${id}`, {
			token: tokens["u-t2"],
			method: "PUT",
			body: completeBody("Hijacked course"),
		});
		expect(otherPut.status).toBe(404);
	});

	it("submit runs the full validation on the saved course", async () => {
		const draft = createdCourses[0];
		const r = await t1(`/teacher/courses/${draft}/submit`, { method: "POST" });
		expect(r.status).toBe(400);
		expect(r.body.error.fields).toMatchObject({
			subject: "Enter the subject, e.g. Physics.",
			"chapters.0.title": "Chapter title is required.",
			"chapters.0.lessons.0.videoUrl":
				"Enter a valid YouTube link or embed code.",
		});

		const ok = await t1(`/teacher/courses/${id}/submit`, { method: "POST" });
		expect(ok.status).toBe(200);
		expect(ok.body.status).toBe("pending");
		const again = await t1(`/teacher/courses/${id}/submit`, { method: "POST" });
		expect(again.status).toBe(422);
	});

	it("a course under review can't be saved incomplete or deleted", async () => {
		const body = completeBody(`Course ${tag} v3`);
		body.chapters[0].lessons[0].videoUrl = "https://vimeo.com/1";
		const r = await t1(`/teacher/courses/${id}`, { method: "PUT", body });
		expect(r.status).toBe(400);
		expect(r.body.error.fields["chapters.0.lessons.0.videoUrl"]).toBeDefined();
		const del = await t1(`/teacher/courses/${id}`, { method: "DELETE" });
		expect(del.status).toBe(422);
		expect(del.body.error.message).toBe(
			"Only draft or rejected courses can be deleted.",
		);
	});

	it("deletes a draft and logs it", async () => {
		const draft = createdCourses[0];
		const r = await t1(`/teacher/courses/${draft}`, { method: "DELETE" });
		expect(r.status).toBe(204);
		expect((await t1(`/teacher/courses/${draft}`)).status).toBe(404);
		const logs = await prisma.activityLog.findMany({
			where: { actorId: "u-t1", at: { gte: startedAt } },
			select: { action: true },
		});
		expect(logs.map((l) => l.action)).toEqual(
			expect.arrayContaining([
				"Created a course draft",
				"Submitted a course for approval",
				"Deleted a course",
			]),
		);
	});
});

describe("coupons", () => {
	const code = `T${tag}`.slice(0, 15);
	const body = (over: Record<string, unknown> = {}) => ({
		code: code.toLowerCase(),
		type: "percent",
		value: 15,
		usageLimit: 5,
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		courseId: "c-ssc-physics",
		...over,
	});
	let couponId: string;

	it("creates, rejects duplicates and foreign courses", async () => {
		const r = await t1("/teacher/coupons", { method: "POST", body: body() });
		expect(r.status).toBe(201);
		couponId = r.body.id;
		createdCoupons.push(couponId);
		expect(r.body).toMatchObject({ code, state: "active", usedCount: 0 });

		const dup = await t1("/teacher/coupons", { method: "POST", body: body() });
		expect(dup.status).toBe(409);
		expect(dup.body.error.fields.code).toBe(
			"You already have a coupon with this code.",
		);

		const foreign = await t1("/teacher/coupons", {
			method: "POST",
			body: body({ code: `X${tag}`.slice(0, 15), courseId: "c-hsc-chemistry" }),
		});
		expect(foreign.status).toBe(400);
		expect(foreign.body.error.fields.courseId).toBeDefined();
	});

	it("updates, toggles and deletes", async () => {
		const put = await t1(`/teacher/coupons/${couponId}`, {
			method: "PUT",
			body: body({ type: "fixed", value: 200, courseId: null }),
		});
		expect(put.status).toBe(200);
		expect(put.body).toMatchObject({
			type: "fixed",
			value: 200,
			courseId: null,
		});

		const off = await t1(`/teacher/coupons/${couponId}/active`, {
			method: "PATCH",
			body: { active: false },
		});
		expect(off.body.state).toBe("inactive");

		const list = await t1("/teacher/coupons");
		expect(list.body.map((c: { id: string }) => c.id)).toContain(couponId);
		const foreign = await call(`/teacher/coupons/${couponId}`, {
			token: tokens["u-t2"],
			method: "DELETE",
		});
		expect(foreign.status).toBe(404);

		expect(
			(await t1(`/teacher/coupons/${couponId}`, { method: "DELETE" })).status,
		).toBe(204);
		expect(
			(await t1(`/teacher/coupons/${couponId}`, { method: "DELETE" })).status,
		).toBe(404);
	});
});

describe("withdrawals", () => {
	it("lists the balance and the default account", async () => {
		const r = await t1("/teacher/withdrawals");
		expect(r.status).toBe(200);
		expect(r.body.finance).toEqual(await loadTeacherFinance(prisma, "t1"));
		expect(r.body.defaultAccount).toMatch(/^01\d{9}$/);
		expect(Array.isArray(r.body.withdrawals)).toBe(true);
	});

	it("enforces the minimum and the withdrawable balance", async () => {
		const { withdrawable } = await loadTeacherFinance(prisma, "t1");
		const low = await t1("/teacher/withdrawals", {
			method: "POST",
			body: { amount: 499, accountNumber: "01700000001" },
		});
		expect(low.status).toBe(400);
		expect(low.body.error.message).toBe("The minimum withdrawal is ৳500.");

		const over = await t1("/teacher/withdrawals", {
			method: "POST",
			body: {
				amount: Math.max(500, withdrawable + 1),
				accountNumber: "01700000001",
			},
		});
		expect(over.status).toBe(422);
		expect(over.body.error.message).toBe(
			"The amount is more than your withdrawable balance.",
		);
	});

	it("concurrent requests never exceed the balance", async () => {
		const { withdrawable } = await loadTeacherFinance(prisma, "t1");
		if (withdrawable < 1000) return;
		const amount = Math.floor(withdrawable / 2) + 1;
		const results = await Promise.all(
			[1, 2].map(() =>
				t1("/teacher/withdrawals", {
					method: "POST",
					body: { amount, accountNumber: "01700000001" },
				}),
			),
		);
		for (const r of results)
			if (r.status === 201) createdWithdrawals.push(r.body.id);
		expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
		const after = await loadTeacherFinance(prisma, "t1");
		expect(after.withdrawable).toBe(withdrawable - amount);
		expect(after.pendingWithdrawals).toBeGreaterThanOrEqual(amount);
		const log = await prisma.activityLog.findFirst({
			where: {
				actorId: "u-t1",
				action: "Requested a withdrawal",
				at: { gte: startedAt },
			},
		});
		expect(log?.target).toBe(`৳${amount.toLocaleString("en-US")}`);
	});
});
