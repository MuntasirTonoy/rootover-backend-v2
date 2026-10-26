// Money invariants (spec tests 4-6) against the real database, through the same
// loader the API will use. Run `npm run db:seed` first, then `npm run test:db`.
import { afterAll, describe, expect, it } from "vitest";
import prisma from "../../src/app/lib/prisma.js";
import { salesTotals } from "../../src/app/utils/finance.js";
import {
	loadTeacherFinance,
	saleRowSelect,
} from "../../src/app/utils/finance.queries.js";

afterAll(() => prisma.$disconnect());

describe("finance on the seeded database", () => {
	it("every stored purchase adds up (spec test 4)", async () => {
		const purchases = await prisma.purchase.findMany();
		expect(purchases.length).toBeGreaterThan(0);
		for (const p of purchases) {
			expect(p.amountPaid).toBe(p.coursePrice - p.couponDiscount);
			expect(p.commission + p.teacherNet).toBe(p.amountPaid);
			expect(p.commission).toBe(Math.round(p.amountPaid * 0.1));
		}
	});

	it("loadTeacherFinance: balances add up and platform = sum of teachers (spec tests 5-6)", async () => {
		const teachers = await prisma.teacherProfile.findMany({
			select: { id: true },
		});
		const finances = await Promise.all(
			teachers.map((t) => loadTeacherFinance(prisma, t.id)),
		);
		for (const f of finances) {
			expect(f.withdrawable).toBeGreaterThanOrEqual(0);
			expect(
				f.pendingClearance +
					f.withdrawn +
					f.pendingWithdrawals +
					f.withdrawable,
			).toBe(f.teacherNet);
		}
		const platform = salesTotals(
			await prisma.purchase.findMany({ select: saleRowSelect }),
		);
		for (const key of [
			"sales",
			"gross",
			"commission",
			"teacherNet",
			"refunds",
		] as const)
			expect(platform[key]).toBe(finances.reduce((s, f) => s + f[key], 0));
	});

	it("works inside a transaction", async () => {
		const teacher = await prisma.teacherProfile.findFirstOrThrow();
		const outside = await loadTeacherFinance(prisma, teacher.id);
		const inside = await prisma.$transaction((tx) =>
			loadTeacherFinance(tx, teacher.id),
		);
		expect(inside).toEqual(outside);
	});
});
