// Checkout, player and student pages against the seeded database (spec 10.3,
// 10.4; spec test 9). Purchases are made by throwaway students created here,
// and every coupon count touched is restored, so the seed stays unchanged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, followPayment, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const DOMAIN = "@student-db.test";
const tag = Date.now().toString(36);
const testUsers: string[] = [];
let couponCounts: { id: string; usedCount: number; usageLimit: number }[] = [];

const newStudent = async (name: string) => {
	const u = await prisma.user.create({
		data: {
			name,
			email: `${name.toLowerCase()}-${tag}${DOMAIN}`,
			passwordHash: "!",
			emailVerifiedAt: new Date(),
		},
	});
	testUsers.push(u.id);
	return { id: u.id, token: await tokenFor(u.id) };
};

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-s1", "u-t1", "u-admin"]) tokens[id] = await tokenFor(id);
	couponCounts = await prisma.coupon.findMany({
		select: { id: true, usedCount: true, usageLimit: true },
	});
});

afterAll(async () => {
	await prisma.lessonCompletion.deleteMany({
		where: { enrollment: { studentId: { in: testUsers } } },
	});
	await prisma.enrollment.deleteMany({
		where: { studentId: { in: testUsers } },
	});
	await prisma.payment.deleteMany({ where: { userId: { in: testUsers } } });
	await prisma.purchase.deleteMany({ where: { studentId: { in: testUsers } } });
	await prisma.activityLog.deleteMany({
		where: { actorId: { in: testUsers } },
	});
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
	for (const c of couponCounts)
		await prisma.coupon.update({
			where: { id: c.id },
			data: { usedCount: c.usedCount, usageLimit: c.usageLimit },
		});
	await app.close();
	await prisma.$disconnect();
});

// Starts a checkout and completes it through the simulated provider's redirect
const buy = async (
	student: { token: string },
	body: { courseId: string; couponCode?: string },
) => {
	const r = await call("/checkout", {
		method: "POST",
		token: student.token,
		body,
	});
	expect(r.status).toBe(201);
	const done = await followPayment(app.base, r.body.redirectURL);
	expect(done.status).toBe(303);
	expect(done.location).toContain(`/payment/result?id=${r.body.paymentId}`);
	return (await call(`/payments/${r.body.paymentId}`, { token: student.token }))
		.body;
};

describe("checkout (simulated provider)", () => {
	it("only students can buy (spec test 9)", async () => {
		for (const id of ["u-t1", "u-admin"]) {
			const r = await call("/checkout", {
				method: "POST",
				token: tokens[id],
				body: { courseId: "c-ssc-physics" },
			});
			expect(r.status).toBe(403);
			expect(r.body.error.message).toBe(
				"Only student accounts can buy courses.",
			);
		}
		expect(
			(
				await call("/checkout", {
					method: "POST",
					body: { courseId: "c-ssc-physics" },
				})
			).status,
		).toBe(401);
	});

	it("quotes with and without a coupon, matching the pricing rules", async () => {
		const buyer = await newStudent("Quoter");
		const plain = await call("/checkout/quote", {
			method: "POST",
			token: buyer.token,
			body: { courseId: "c-ssc-physics" },
		});
		expect(plain.body).toEqual({
			quote: {
				listPrice: 1500,
				coursePrice: 1200,
				courseDiscount: 300,
				couponDiscount: 0,
				total: 1200,
				commission: 120,
				teacherNet: 1080,
			},
			coupon: null,
		});
		const coupon = await call("/checkout/quote", {
			method: "POST",
			token: buyer.token,
			body: { courseId: "c-ssc-physics", couponCode: " physics20 " },
		});
		expect(coupon.body.quote).toMatchObject({
			couponDiscount: 240,
			total: 960,
			commission: 96,
			teacherNet: 864,
		});
		expect(coupon.body.coupon).toEqual({
			code: "PHYSICS20",
			type: "percent",
			value: 20,
		});
	});

	it("rejects bad coupons and unavailable courses with 422 and the spec messages", async () => {
		const buyer = await newStudent("Rejected");
		const quote = (courseId: string, couponCode?: string) =>
			call("/checkout/quote", {
				method: "POST",
				token: buyer.token,
				body: { courseId, couponCode },
			});
		let r = await quote("c-ssc-physics", "EID25");
		expect(r.status).toBe(422);
		expect(r.body.error.fields.couponCode).toBe("This coupon has expired.");
		expect((await quote("c-hsc-physics", "PHYSICS20")).body.error.message).toBe(
			"This coupon isn't valid for this course.",
		);
		expect(
			(await quote("c-bba-accounting", "ACCOUNT10")).body.error.message,
		).toBe("This coupon is no longer active.");
		expect((await quote("c-ssc-physics", "NOPE")).body.error.message).toBe(
			"This coupon code doesn't exist.",
		);
		r = await quote("c-hsc-highermath");
		expect(r.status).toBe(422);
		expect(r.body.error.message).toBe(
			"This course isn't available for purchase.",
		);
	});

	it("lists the coupon codes that currently work for a course", async () => {
		const buyer = await newStudent("Hinted");
		const r = await call("/checkout/coupons/c-ssc-physics", {
			token: buyer.token,
		});
		expect(r.body).toEqual(["PHYSICS20", "KARIM100"]);
		expect(
			(await call("/checkout/coupons/c-hsc-physics", { token: buyer.token }))
				.body,
		).toEqual(["KARIM100"]);
	});

	it("buys a course: purchase + enrollment + coupon use + activity log, then refuses a second buy", async () => {
		const buyer = await newStudent("Buyer");
		const before = await prisma.coupon.findFirstOrThrow({
			where: { code: "PHYSICS20" },
		});
		const payment = await buy(buyer, {
			courseId: "c-ssc-physics",
			couponCode: "PHYSICS20",
		});
		expect(payment).toMatchObject({
			purpose: "course_purchase",
			state: "completed",
			amount: 960,
			course: { id: "c-ssc-physics" },
		});
		expect(payment.purchase).toMatchObject({
			studentId: buyer.id,
			courseId: "c-ssc-physics",
			teacherId: "t1",
			listPrice: 1500,
			coursePrice: 1200,
			couponCode: "PHYSICS20",
			couponDiscount: 240,
			amountPaid: 960,
			commission: 96,
			teacherNet: 864,
			method: "bKash",
			status: "completed",
		});
		expect(payment.purchase.trxId).toMatch(/^DEMO[A-Z0-9]{8,}$/);
		expect(payment.trxId).toBe(payment.purchase.trxId);
		expect(payment.enrollment).toMatchObject({
			studentId: buyer.id,
			courseId: "c-ssc-physics",
			purchaseId: payment.purchase.id,
		});
		expect(
			(await prisma.coupon.findFirstOrThrow({ where: { code: "PHYSICS20" } }))
				.usedCount,
		).toBe(before.usedCount + 1);
		expect(
			await prisma.activityLog.count({
				where: {
					actorId: buyer.id,
					action: "Purchased a course (simulated payment)",
					target: "SSC Physics: Complete Course",
				},
			}),
		).toBe(1);

		const again = await call("/checkout", {
			method: "POST",
			token: buyer.token,
			body: { courseId: "c-ssc-physics" },
		});
		expect(again.status).toBe(409);
		expect(again.body.error.message).toBe("You already own this course.");
	});

	it("never lets two buyers take a coupon's last use", async () => {
		await prisma.coupon.updateMany({
			where: { code: "CODE50" },
			data: { usageLimit: 20, usedCount: 19 },
		});
		const [a, b] = [await newStudent("RaceA"), await newStudent("RaceB")];
		const results = await Promise.all(
			[a, b].map((s) =>
				call("/checkout", {
					method: "POST",
					token: s.token,
					body: {
						courseId: "c-other-c",
						couponCode: "CODE50",
					},
				}),
			),
		);
		expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
		expect(
			(await prisma.coupon.findFirstOrThrow({ where: { code: "CODE50" } }))
				.usedCount,
		).toBe(20);
		const loser = results.find((r) => r.status === 422);
		expect(loser?.body.error.message).toBe(
			"This coupon has reached its usage limit.",
		);
	});

	it("a cancelled or failed payment buys nothing and gives the coupon use back", async () => {
		const buyer = await newStudent("Cancel");
		const before = await prisma.coupon.findFirstOrThrow({
			where: { code: "PHYSICS20" },
		});
		const r = await call("/checkout", {
			method: "POST",
			token: buyer.token,
			body: { courseId: "c-ssc-physics", couponCode: "PHYSICS20" },
		});
		expect(r.status).toBe(201);
		expect(
			(await prisma.coupon.findUniqueOrThrow({ where: { id: before.id } }))
				.usedCount,
		).toBe(before.usedCount + 1);
		// The payer pressed cancel on bKash's page
		const url = new URL(r.body.redirectURL);
		url.searchParams.set("status", "cancel");
		await followPayment(app.base, url.toString());
		const payment = await call(`/payments/${r.body.paymentId}`, {
			token: buyer.token,
		});
		expect(payment.body).toMatchObject({ state: "cancelled" });
		expect(payment.body.purchase).toBeUndefined();
		expect(
			(await prisma.coupon.findUniqueOrThrow({ where: { id: before.id } }))
				.usedCount,
		).toBe(before.usedCount);
		// A late "success" for the same payment changes nothing
		url.searchParams.set("status", "success");
		await followPayment(app.base, url.toString());
		expect(
			await prisma.purchase.count({ where: { studentId: buyer.id } }),
		).toBe(0);
		// Someone else's payment is a 404
		expect(
			(await call(`/payments/${r.body.paymentId}`, { token: tokens["u-s1"] }))
				.status,
		).toBe(404);
	});
});

describe("player, watch tracking and completion", () => {
	let learner: { id: string; token: string };

	beforeAll(async () => {
		learner = await newStudent("Learner");
		await buy(learner, { courseId: "c-bsc-calculus" });
	});

	it("guests get previews only; buyers get every lesson", async () => {
		const guest = await call("/learn/c-bsc-calculus");
		expect(guest.body).toMatchObject({
			savedLessonIds: [],
			myOpenReportLessonIds: [],
			course: { access: { full: false } },
		});
		const owner = await call("/learn/c-bsc-calculus", { token: learner.token });
		expect(owner.body.course.access).toMatchObject({
			enrolled: true,
			full: true,
		});
		expect(
			owner.body.course.chapters.every(
				(ch: { lessons: { videoUrl: string | null }[] }) =>
					ch.lessons.every((l) => l.videoUrl),
			),
		).toBe(true);
		expect(owner.body.course.enrollment.progress).toEqual({
			completed: 0,
			total: 9,
			percent: 0,
		});
	});

	it("lists the demo student's saved lessons and open reports in the player", async () => {
		const r = await call("/learn/c-ssc-physics", { token: tokens["u-s1"] });
		expect(r.body.savedLessonIds.sort()).toEqual([
			"c-ssc-physics-ch2-l3",
			"c-ssc-physics-ch3-l1",
		]);
		expect(r.body.myOpenReportLessonIds.sort()).toEqual([
			"c-ssc-physics-ch1-l2",
			"c-ssc-physics-ch2-l2",
		]);
	});

	it("records the last watched lesson for enrolled students only", async () => {
		const watch = (courseId: string, lessonId: string, token = learner.token) =>
			call(`/learn/${courseId}/lessons/${lessonId}/watch`, {
				method: "POST",
				token,
			});
		expect(
			(await watch("c-bsc-calculus", "c-bsc-calculus-ch2-l1")).status,
		).toBe(204);
		let e = await prisma.enrollment.findFirstOrThrow({
			where: { studentId: learner.id, courseId: "c-bsc-calculus" },
		});
		expect(e.lastLessonId).toBe("c-bsc-calculus-ch2-l1");
		const firstWatch = e.lastWatchedAt;
		await watch("c-bsc-calculus", "c-bsc-calculus-ch2-l1");
		e = await prisma.enrollment.findFirstOrThrow({ where: { id: e.id } });
		expect(e.lastWatchedAt).toEqual(firstWatch); // same lesson: no write
		expect((await watch("c-ssc-physics", "c-ssc-physics-ch1-l1")).status).toBe(
			204,
		); // preview, not enrolled: no-op
		expect((await watch("c-bsc-calculus", "c-ssc-physics-ch1-l1")).status).toBe(
			404,
		); // lesson of another course
		// Teachers may track courses they bought; one who didn't is a no-op
		expect(
			(await watch("c-bsc-calculus", "c-bsc-calculus-ch1-l1", tokens["u-t1"]))
				.status,
		).toBe(204);
		expect(
			(
				await watch(
					"c-bsc-calculus",
					"c-bsc-calculus-ch1-l1",
					tokens["u-admin"],
				)
			).status,
		).toBe(403);
		const detail = await call("/courses/c-bsc-calculus", {
			token: learner.token,
		});
		expect(detail.body.enrollment.resumeLessonId).toBe("c-bsc-calculus-ch2-l1");
	});

	it("marks lessons complete and incomplete, idempotently", async () => {
		const complete = (
			lessonId: string,
			done: unknown,
			courseId = "c-bsc-calculus",
		) =>
			call(`/learn/${courseId}/lessons/${lessonId}/complete`, {
				method: "PUT",
				token: learner.token,
				body: { done },
			});
		expect((await complete("c-bsc-calculus-ch1-l1", true)).body).toEqual({
			progress: { completed: 1, total: 9, percent: 11 },
		});
		expect(
			(await complete("c-bsc-calculus-ch1-l1", true)).body.progress.completed,
		).toBe(1);
		expect(
			(await complete("c-bsc-calculus-ch1-l2", true)).body.progress,
		).toEqual({ completed: 2, total: 9, percent: 22 });
		expect(
			(await complete("c-bsc-calculus-ch1-l1", false)).body.progress.completed,
		).toBe(1);
		expect((await complete("c-bsc-calculus-ch1-l1", "yes")).status).toBe(400);
		expect((await complete("c-ssc-physics-ch1-l1", true)).status).toBe(404);
		const notEnrolled = await complete(
			"c-ssc-physics-ch1-l1",
			true,
			"c-ssc-physics",
		);
		expect(notEnrolled.status).toBe(403);
		expect(notEnrolled.body.error.message).toBe(
			"Enroll in this course to track your progress.",
		);
	});
});

describe("My Classes, saved lessons, purchases and dashboard (demo student)", () => {
	const s1 = () => tokens["u-s1"];

	it("lists enrollments, most recently watched first, with progress and filters", async () => {
		const all = (await call("/me/enrollments", { token: s1() })).body;
		expect(all.map((e: { course: { id: string } }) => e.course.id)).toEqual([
			"c-ssc-physics",
			"c-hsc-physics",
			"c-hsc-chemistry",
			"c-bba-accounting",
		]);
		const physics = all[0];
		expect(physics.progress).toEqual({ completed: 7, total: 12, percent: 58 });
		expect(physics.lastLesson).toEqual({
			id: "c-ssc-physics-ch3-l2",
			title: "Momentum and impulse",
			chapterTitle: "Force",
		});
		expect(physics.enrollment.completedLessonIds).toHaveLength(7);
		const ids = async (qs: string) =>
			(await call(`/me/enrollments?${qs}`, { token: s1() })).body.map(
				(e: { course: { id: string } }) => e.course.id,
			);
		expect(await ids("progress=completed")).toEqual(["c-hsc-chemistry"]);
		expect(await ids("progress=not-started")).toEqual(["c-bba-accounting"]);
		expect(await ids("progress=in-progress")).toEqual([
			"c-ssc-physics",
			"c-hsc-physics",
		]);
		expect(await ids("q=karim")).toEqual(["c-ssc-physics", "c-hsc-physics"]);
		expect(await ids("level=BBA")).toEqual(["c-bba-accounting"]);
	});

	it("lists saved lessons newest first, with search and course filters", async () => {
		const saved = (await call("/me/saved-lessons", { token: s1() })).body;
		expect(saved).toHaveLength(4);
		const dates = saved.map((s: { savedAt: string }) => s.savedAt);
		expect(dates).toEqual([...dates].sort().reverse());
		expect(saved[0]).toMatchObject({
			lesson: { id: "c-ssc-physics-ch3-l1" },
			chapter: { title: "Force", index: 2 },
			course: { id: "c-ssc-physics", level: "SSC" },
			teacher: { id: "t1", name: "Dr. Rezaul Karim" },
		});
		expect(
			(
				await call("/me/saved-lessons?courseId=c-hsc-chemistry", {
					token: s1(),
				})
			).body,
		).toHaveLength(1);
		expect(
			(await call("/me/saved-lessons?q=vector", { token: s1() })).body.map(
				(s: { lesson: { id: string } }) => s.lesson.id,
			),
		).toEqual(["c-hsc-physics-ch1-l2"]);
	});

	it("saves only watchable lessons, refuses duplicates, and unsaves idempotently", async () => {
		const saver = await newStudent("Saver");
		const save = (courseId: string, lessonId: string) =>
			call("/me/saved-lessons", {
				method: "POST",
				token: saver.token,
				body: { courseId, lessonId },
			});
		const preview = await save("c-ssc-physics", "c-ssc-physics-ch1-l1");
		expect(preview.status).toBe(201);
		expect(preview.body.lesson.id).toBe("c-ssc-physics-ch1-l1");
		expect((await save("c-ssc-physics", "c-ssc-physics-ch1-l1")).status).toBe(
			409,
		);
		const locked = await save("c-ssc-physics", "c-ssc-physics-ch2-l1");
		expect(locked.status).toBe(403);
		expect(locked.body.error.message).toBe(
			"You can only save lessons you can watch.",
		);
		expect(
			(await save("c-hsc-highermath", "c-hsc-highermath-ch1-l1")).status,
		).toBe(403); // preview of an unpublished course
		expect((await save("c-ssc-physics", "c-hsc-physics-ch1-l1")).status).toBe(
			404,
		);
		for (let i = 0; i < 2; i++)
			expect(
				(
					await call("/me/saved-lessons/c-ssc-physics-ch1-l1", {
						method: "DELETE",
						token: saver.token,
					})
				).status,
			).toBe(204);
		expect(
			(await call("/me/saved-lessons", { token: saver.token })).body,
		).toEqual([]);
		await prisma.savedLesson.deleteMany({ where: { studentId: saver.id } });
	});

	it("shows purchase history with totals over completed purchases", async () => {
		const { body } = await call("/me/purchases", { token: s1() });
		expect(body.purchases).toHaveLength(4);
		expect(
			body.purchases.map((p: { course: { id: string } }) => p.course.id),
		).toEqual([
			"c-bba-accounting",
			"c-hsc-physics",
			"c-ssc-physics",
			"c-hsc-chemistry",
		]);
		expect(body.purchases[0]).toMatchObject({
			student: { id: "u-s1", name: "Tanvir Ahmed" },
			teacher: { id: "t4" },
		});
		const paid = body.purchases.reduce(
			(s: number, p: { amountPaid: number }) => s + p.amountPaid,
			0,
		);
		const saved = body.purchases.reduce(
			(s: number, p: { listPrice: number; amountPaid: number }) =>
				s + p.listPrice - p.amountPaid,
			0,
		);
		expect(body.totals).toEqual({ count: 4, paid, saved });
	});

	it("builds the dashboard", async () => {
		const { status, body } = await call("/me/dashboard", { token: s1() });
		expect(status).toBe(200);
		expect(body.stats).toEqual({
			enrolled: 4,
			lessonsCompleted: 18,
			lessonsTotal: 36,
			overallPercent: 50,
			saved: 4,
		});
		expect(
			body.continueLearning.map((e: { course: { id: string } }) => e.course.id),
		).toEqual(["c-ssc-physics", "c-hsc-physics"]);
		expect(
			body.recentlyWatched.map((e: { course: { id: string } }) => e.course.id),
		).toEqual(["c-ssc-physics", "c-hsc-physics", "c-hsc-chemistry"]);
		expect(body.saved).toHaveLength(4);
		expect(body.recentPurchases).toHaveLength(4);
		expect(body.application).toBeNull();
	});

	it("is for students only (teachers also see their purchased courses)", async () => {
		for (const path of ["/me/dashboard", "/me/saved-lessons", "/me/purchases"])
			expect((await call(path, { token: tokens["u-t1"] })).status).toBe(403);
		expect(
			(await call("/me/enrollments", { token: tokens["u-t1"] })).status,
		).toBe(200);
		expect(
			(await call("/me/enrollments", { token: tokens["u-admin"] })).status,
		).toBe(403);
		expect((await call("/me/dashboard")).status).toBe(401);
	});
});
