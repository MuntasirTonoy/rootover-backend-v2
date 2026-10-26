// BACKEND_SPEC section 19, tests 1-3 and 7 (money maths and coupon checks)
import { describe, expect, it } from "vitest";
import { buildSeedData } from "../../prisma/seed/data.js";
import {
	COMMISSION_RATE,
	checkCoupon,
	couponDiscount,
	coursePrice,
	discountPercent,
	quote,
	splitSale,
} from "../../src/app/utils/pricing.js";

describe("quote", () => {
	it("spec test 1: ৳1,000 with a 20% coupon -> pays 800, commission 80, teacher 720", () => {
		expect(quote({ price: 1000 }, { type: "percent", value: 20 })).toEqual({
			listPrice: 1000,
			coursePrice: 1000,
			courseDiscount: 0,
			couponDiscount: 200,
			total: 800,
			commission: 80,
			teacherNet: 720,
		});
	});

	it("spec test 2: ৳1,500 discounted to ৳1,200 plus a ৳100 fixed coupon -> 1,100", () => {
		const q = quote(
			{ price: 1500, discountPrice: 1200 },
			{ type: "fixed", value: 100 },
		);
		expect(q.coursePrice).toBe(1200);
		expect(q.courseDiscount).toBe(300);
		expect(q.couponDiscount).toBe(100);
		expect(q.total).toBe(1100);
		expect(q.commission + q.teacherNet).toBe(1100);
	});

	it("spec test 3: a fixed coupon larger than the price makes it free, never negative", () => {
		const q = quote({ price: 800 }, { type: "fixed", value: 5000 });
		expect(q.couponDiscount).toBe(800);
		expect(q.total).toBe(0);
		expect(q.commission).toBe(0);
		expect(q.teacherNet).toBe(0);
	});

	it("works without a coupon", () => {
		expect(quote({ price: 2000, discountPrice: 1600 })).toMatchObject({
			coursePrice: 1600,
			courseDiscount: 400,
			couponDiscount: 0,
			total: 1600,
			commission: 160,
			teacherNet: 1440,
		});
	});
});

describe("coursePrice / discountPercent", () => {
	it("ignores a discount that is missing, zero or not lower than the price", () => {
		expect(coursePrice({ price: 1000 })).toBe(1000);
		expect(coursePrice({ price: 1000, discountPrice: null })).toBe(1000);
		expect(coursePrice({ price: 1000, discountPrice: 0 })).toBe(1000);
		expect(coursePrice({ price: 1000, discountPrice: 1000 })).toBe(1000);
		expect(coursePrice({ price: 1000, discountPrice: 1200 })).toBe(1000);
		expect(coursePrice({ price: 1000, discountPrice: 999 })).toBe(999);
	});

	it("rounds the discount percentage", () => {
		expect(discountPercent({ price: 1500, discountPrice: 1200 })).toBe(20);
		expect(discountPercent({ price: 1200, discountPrice: 999 })).toBe(17);
		expect(discountPercent({ price: 1000 })).toBe(0);
	});
});

describe("couponDiscount / splitSale", () => {
	it("rounds percentage coupons to whole taka", () => {
		expect(couponDiscount(999, { type: "percent", value: 15 })).toBe(150);
		expect(couponDiscount(1200, { type: "percent", value: 20 })).toBe(240);
	});

	it("commission is 10% of the amount paid, rounded; the rest goes to the teacher", () => {
		expect(COMMISSION_RATE).toBe(0.1);
		for (const amount of [0, 1, 5, 849, 999, 1015, 1530, 2250]) {
			const { commission, teacherNet } = splitSale(amount);
			expect(commission).toBe(Math.round(amount * 0.1));
			expect(commission + teacherNet).toBe(amount);
		}
		expect(splitSale(1015)).toEqual({ commission: 102, teacherNet: 913 });
	});
});

describe("checkCoupon (spec test 7, seeded coupons)", () => {
	const data = buildSeedData();
	const course = (id: string) => {
		const c = data.courses.find((x) => x.id === id);
		if (!c) throw new Error(id);
		return c;
	};
	const withCode = (code: string, coupons = data.coupons) =>
		coupons.filter((c) => c.code.toLowerCase() === code.toLowerCase());
	const check = (code: string, courseId: string, coupons = data.coupons) =>
		checkCoupon(withCode(code, coupons), course(courseId), code);

	it("PHYSICS20 is valid on SSC Physics (any case, trimmed)", () => {
		const r = checkCoupon(
			withCode("physics20"),
			course("c-ssc-physics"),
			"  physics20 ",
		);
		expect(r.ok && r.coupon.code).toBe("PHYSICS20");
	});

	it("PHYSICS20 is not valid on HSC Physics (same teacher, other course)", () => {
		expect(check("PHYSICS20", "c-hsc-physics")).toEqual({
			ok: false,
			error: "This coupon isn't valid for this course.",
		});
	});

	it("KARIM100 (all of Dr. Karim's courses) is valid on his course but not another teacher's", () => {
		expect(check("KARIM100", "c-hsc-physics").ok).toBe(true);
		expect(check("KARIM100", "c-hsc-chemistry")).toEqual({
			ok: false,
			error: "This coupon isn't valid for this course.",
		});
	});

	it("EID25 has expired", () => {
		expect(check("EID25", "c-ssc-physics")).toEqual({
			ok: false,
			error: "This coupon has expired.",
		});
	});

	it("ACCOUNT10 is inactive", () => {
		expect(check("ACCOUNT10", "c-bba-accounting")).toEqual({
			ok: false,
			error: "This coupon is no longer active.",
		});
	});

	it("an unknown code doesn't exist", () => {
		expect(check("NOPE2026", "c-ssc-physics")).toEqual({
			ok: false,
			error: "This coupon code doesn't exist.",
		});
	});

	it("a coupon at its usage limit is refused", () => {
		const used = data.coupons.map((c) =>
			c.code === "CODE50" ? { ...c, usedCount: c.usageLimit } : c,
		);
		expect(check("CODE50", "c-other-c", used)).toEqual({
			ok: false,
			error: "This coupon has reached its usage limit.",
		});
	});

	it("reports the first failure in spec order (wrong teacher beats expired)", () => {
		// EID25 is Dr. Karim's and expired; on another teacher's course the teacher check wins
		expect(check("EID25", "c-hsc-chemistry")).toEqual({
			ok: false,
			error: "This coupon isn't valid for this course.",
		});
	});

	it("the same code from another teacher doesn't block the course's own teacher", () => {
		const shared = [
			...data.coupons,
			{ ...data.coupons[0], id: "other", teacherId: "t2", courseId: null },
		];
		expect(check("PHYSICS20", "c-ssc-physics", shared).ok).toBe(true);
	});
});
