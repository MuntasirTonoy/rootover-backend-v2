// BACKEND_SPEC section 19, tests 4-6 on the seed dataset (no database needed)
import { describe, expect, it } from "vitest";
import { buildSeedData } from "../../prisma/seed/data.js";
import {
	platformSummary,
	salesTotals,
	teacherFinance,
} from "../../src/app/utils/finance.js";

const NOW = Date.now();
const data = buildSeedData(NOW);

describe("seeded money data", () => {
	it("spec test 4: every purchase adds up", () => {
		for (const p of data.purchases) {
			expect(p.amountPaid).toBe(p.coursePrice - p.couponDiscount);
			expect(p.commission + p.teacherNet).toBe(p.amountPaid);
			expect(p.commission).toBe(Math.round(p.amountPaid * 0.1));
			expect(p.listPrice).toBeGreaterThanOrEqual(p.coursePrice);
		}
	});

	it("spec test 5: every teacher's balance adds up and is never negative", () => {
		for (const t of data.teachers) {
			const f = teacherFinance(
				data.purchases.filter((p) => p.teacherId === t.id),
				data.withdrawals.filter((w) => w.teacherId === t.id),
				NOW,
			);
			expect(f.withdrawable).toBeGreaterThanOrEqual(0);
			expect(
				f.pendingClearance +
					f.withdrawn +
					f.pendingWithdrawals +
					f.withdrawable,
			).toBe(f.teacherNet);
			// The seed only ever withdraws cleared money
			expect(f.withdrawable).toBeGreaterThan(0);
		}
	});

	it("spec test 6: platform totals equal the sum over all teachers", () => {
		const platform = salesTotals(data.purchases);
		const perTeacher = data.teachers.map((t) =>
			salesTotals(data.purchases.filter((p) => p.teacherId === t.id)),
		);
		for (const key of [
			"sales",
			"gross",
			"commission",
			"teacherNet",
			"refunds",
		] as const)
			expect(platform[key]).toBe(perTeacher.reduce((s, t) => s + t[key], 0));
	});

	it("has recent sales (pending clearance) and exactly one refund", () => {
		const recent = data.purchases.filter(
			(p) =>
				p.status === "completed" &&
				NOW - p.createdAt.getTime() < 7 * 86_400_000,
		);
		expect(recent.length).toBeGreaterThan(0);
		expect(data.purchases.filter((p) => p.status === "refunded")).toHaveLength(
			1,
		);
	});

	it("platform revenue includes the ৳300 registration fees", () => {
		const s = platformSummary(data.purchases, data.registrationFees);
		expect(s.registrationFees.count).toBe(5);
		expect(s.platformRevenue).toBe(s.totals.commission + 5 * 300);
	});
});
