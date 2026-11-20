// The cart (POST /api/checkout/cart/quote and /api/checkout/cart): several
// courses in one payment, each with its own coupon. Payments run through the
// simulated provider (vitest.config.ts). Creates its own teacher, courses and
// student, so it doesn't need the demo seed, and removes them afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, followPayment, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tag = Date.now().toString(36);
const users: string[] = [];
let teacherProfileId = "";
const courses: Record<string, string> = {};
let studentToken = "";
let studentId = "";
let couponId = "";

// Five approved courses: A-C for the main cart, D-E for the "bought meanwhile"
// case. A and B cost the same (the case bKash rejects as a duplicate when paid
// one after the other); C has a discount.
const PRICES = { A: 510, B: 510, C: 800, D: 300, E: 400 } as const;

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	const teacherUser = await prisma.user.create({
		data: {
			name: `Cart Teacher ${tag}`,
			email: `cart-teacher-${tag}@cart-db.test`,
			passwordHash: "x",
			emailVerifiedAt: new Date(),
			role: "teacher",
		},
	});
	users.push(teacherUser.id);
	const profile = await prisma.teacherProfile.create({
		data: { userId: teacherUser.id, teacherCode: `CART-${tag}` },
	});
	teacherProfileId = profile.id;
	for (const [key, price] of Object.entries(PRICES)) {
		const course = await prisma.course.create({
			data: {
				teacherId: profile.id,
				level: "HSC",
				subject: "Mathematics",
				title: `Cart course ${key} ${tag}`,
				description: "Cart test course",
				price,
				discountPrice: key === "C" ? 600 : null,
				status: "approved",
				chapters: {
					create: {
						title: "Chapter 1",
						position: 0,
						lessons: {
							create: {
								title: "Lesson 1",
								durationMin: 10,
								videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
								position: 0,
							},
						},
					},
				},
			},
		});
		courses[key] = course.id;
	}
	const coupon = await prisma.coupon.create({
		data: {
			teacherId: profile.id,
			code: `CART${tag}`.toUpperCase(),
			type: "percent",
			value: 10,
			expiresAt: new Date(Date.now() + 86_400_000),
			usageLimit: 5,
			courseId: courses.A,
		},
	});
	couponId = coupon.id;
	const student = await prisma.user.create({
		data: {
			name: `Cart Student ${tag}`,
			email: `cart-student-${tag}@cart-db.test`,
			passwordHash: "x",
			emailVerifiedAt: new Date(),
		},
	});
	users.push(student.id);
	studentId = student.id;
	studentToken = await tokenFor(student.id);
});

afterAll(async () => {
	const courseIds = Object.values(courses);
	await prisma.enrollment.deleteMany({
		where: { courseId: { in: courseIds } },
	});
	await prisma.payment.deleteMany({ where: { userId: { in: users } } });
	await prisma.purchase.deleteMany({ where: { courseId: { in: courseIds } } });
	await prisma.coupon.deleteMany({ where: { teacherId: teacherProfileId } });
	await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
	await prisma.teacherProfile.deleteMany({ where: { id: teacherProfileId } });
	await prisma.activityLog.deleteMany({ where: { actorId: { in: users } } });
	await prisma.user.deleteMany({ where: { id: { in: users } } });
	await app.close();
});

const cart = (path: string, items: unknown[]) =>
	call(`/checkout/cart${path}`, {
		method: "POST",
		token: studentToken,
		body: { items },
	});

describe("cart quote", () => {
	it("prices each course, with per-course coupon and error messages", async () => {
		const res = await cart("/quote", [
			{ courseId: courses.A, couponCode: `cart${tag}` },
			{ courseId: courses.B, couponCode: "NOPE" },
			{ courseId: courses.C },
			{ courseId: "not-a-course" },
		]);
		expect(res.status).toBe(200);
		const [a, b, c, missing] = res.body.items;
		expect(a.quote.total).toBe(459); // 510 - 10%
		expect(a.coupon.code).toBe(`CART${tag}`.toUpperCase());
		expect(a.course).toMatchObject({ id: courses.A, level: "HSC" });
		expect(b.quote.total).toBe(510);
		expect(b.coupon).toBeNull();
		expect(b.couponError).toBe("This coupon code doesn't exist.");
		expect(c.quote.total).toBe(600);
		expect(missing.error).toBe("This course isn't available for purchase.");
		expect(res.body.total).toBe(459 + 510 + 600);
	});

	it("rejects an empty cart and the same course twice", async () => {
		expect((await cart("/quote", [])).status).toBe(400);
		const twice = await cart("/quote", [
			{ courseId: courses.A },
			{ courseId: courses.A },
		]);
		expect(twice.status).toBe(400);
	});
});

describe("cart checkout", () => {
	it("pays for several courses in one payment", async () => {
		const start = await cart("", [
			{ courseId: courses.A, couponCode: `CART${tag}` },
			{ courseId: courses.B },
			{ courseId: courses.C },
		]);
		expect(start.status).toBe(201);
		const payment = await prisma.payment.findUniqueOrThrow({
			where: { id: start.body.paymentId },
			include: { items: true },
		});
		expect(payment.amount).toBe(459 + 510 + 600);
		expect(payment.items).toHaveLength(3);
		expect(payment.courseId).toBeNull();
		// The coupon use is reserved while the payment is open
		expect(
			(await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
				.usedCount,
		).toBe(1);

		const back = await followPayment(app.base, start.body.redirectURL);
		expect(back.location).toContain(`/payment/result?id=${payment.id}`);

		const view = await call(`/payments/${payment.id}`, { token: studentToken });
		expect(view.body.state).toBe("completed");
		expect(view.body.items).toHaveLength(3);
		expect(view.body.items.every((i: { granted: boolean }) => i.granted)).toBe(
			true,
		);

		// One purchase + enrollment per course, all with the one transaction id
		const purchases = await prisma.purchase.findMany({
			where: { studentId, courseId: { in: [courses.A, courses.B, courses.C] } },
		});
		expect(purchases).toHaveLength(3);
		expect(new Set(purchases.map((p) => p.trxId)).size).toBe(1);
		expect(purchases.find((p) => p.courseId === courses.A)).toMatchObject({
			couponCode: `CART${tag}`.toUpperCase(),
			amountPaid: 459,
		});
		expect(
			await prisma.enrollment.count({
				where: {
					studentId,
					courseId: { in: [courses.A, courses.B, courses.C] },
				},
			}),
		).toBe(3);
		expect(
			(await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } }))
				.usedCount,
		).toBe(1);
	});

	it("refuses a cart with a course the student already owns", async () => {
		const res = await cart("", [
			{ courseId: courses.D },
			{ courseId: courses.A },
		]);
		expect(res.status).toBe(409);
		expect(res.body.error.fields["items.1.courseId"]).toBe(
			"You already own this course.",
		);
		const quoted = await cart("/quote", [{ courseId: courses.A }]);
		expect(quoted.body.items[0].error).toBe("You already own this course.");
		expect(quoted.body.total).toBe(0);
	});

	it("reports a bad coupon on its course", async () => {
		const res = await cart("", [
			{ courseId: courses.D },
			{ courseId: courses.E, couponCode: "NOPE" },
		]);
		expect(res.status).toBe(422);
		expect(res.body.error.fields["items.1.couponCode"]).toBe(
			"This coupon code doesn't exist.",
		);
	});

	it("grants the rest when one course was bought while paying", async () => {
		const started = await cart("", [
			{ courseId: courses.D },
			{ courseId: courses.E },
		]);
		expect(started.status).toBe(201);

		// Meanwhile, D is bought on its own with "Buy now"
		const single = await call("/checkout", {
			method: "POST",
			token: studentToken,
			body: { courseId: courses.D },
		});
		expect(single.status).toBe(201);
		await followPayment(app.base, single.body.redirectURL);
		const singleView = await call(`/payments/${single.body.paymentId}`, {
			token: studentToken,
		});
		expect(singleView.body.state).toBe("completed");
		expect(singleView.body.course.id).toBe(courses.D);
		expect(singleView.body.purchase.courseId).toBe(courses.D);

		// The cart still completes: E is granted, D is marked for a refund
		await followPayment(app.base, started.body.redirectURL);
		const view = await call(`/payments/${started.body.paymentId}`, {
			token: studentToken,
		});
		expect(view.body.state).toBe("completed");
		const d = view.body.items.find(
			(i: { course: { id: string } }) => i.course.id === courses.D,
		);
		const e = view.body.items.find(
			(i: { course: { id: string } }) => i.course.id === courses.E,
		);
		expect(d.granted).toBe(false);
		expect(d.refundNote).toMatch(/refund/);
		expect(e.granted).toBe(true);
		expect(
			await prisma.purchase.count({
				where: { studentId, courseId: courses.D },
			}),
		).toBe(1);
	});

	it("is for students only", async () => {
		const teacherToken = await tokenFor(users[0]);
		const res = await call("/checkout/cart", {
			method: "POST",
			token: teacherToken,
			body: { items: [{ courseId: courses.A }] },
		});
		expect(res.status).toBe(403);
	});
});

describe("cart quote for guests", () => {
	it("prices a cart without logging in (no ownership check)", async () => {
		const res = await call("/checkout/cart/quote", {
			method: "POST",
			body: { items: [{ courseId: courses.A }, { courseId: courses.C }] },
		});
		expect(res.status).toBe(200);
		expect(res.body.items[0].error).toBeUndefined();
		expect(res.body.total).toBe(510 + 600);
		// Paying still needs an account
		const pay = await call("/checkout/cart", {
			method: "POST",
			body: { items: [{ courseId: courses.A }] },
		});
		expect(pay.status).toBe(401);
	});
});
