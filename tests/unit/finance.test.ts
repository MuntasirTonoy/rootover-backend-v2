import { describe, expect, it } from "vitest";
import {
	monthlySeries,
	platformSummary,
	type SaleRow,
	salesTotals,
	teacherFinance,
	type WithdrawalRow,
} from "../../src/app/utils/finance.js";
import {
	DEFAULT_COMMISSION_RATE,
	splitSale,
} from "../../src/app/utils/pricing.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 6, 0); // 2026-10-25 12:00 in Dhaka

const sale = (
	amountPaid: number,
	daysAgo: number,
	status: SaleRow["status"] = "completed",
	listPrice = amountPaid,
): SaleRow => ({
	status,
	listPrice,
	amountPaid,
	...splitSale(amountPaid, DEFAULT_COMMISSION_RATE),
	createdAt: new Date(NOW - daysAgo * DAY),
});

const withdrawal = (
	amount: number,
	status: WithdrawalRow["status"],
): WithdrawalRow => ({ amount, status });

const balanceAddsUp = (f: ReturnType<typeof teacherFinance>) =>
	f.pendingClearance + f.withdrawn + f.pendingWithdrawals + f.withdrawable;

describe("salesTotals", () => {
	it("sums completed sales and keeps refunds separate", () => {
		const t = salesTotals([
			sale(800, 30, "completed", 1000),
			sale(1200, 20, "completed", 1500),
			sale(999, 10, "refunded", 1200),
		]);
		expect(t).toEqual({
			sales: 2,
			listTotal: 2500,
			discounts: 500,
			gross: 2000,
			commission: 200,
			teacherNet: 1800,
			refunds: 999,
			refundedCount: 1,
		});
	});

	it("is all zeros with no purchases", () => {
		expect(salesTotals([])).toMatchObject({ sales: 0, gross: 0, refunds: 0 });
	});
});

describe("teacherFinance", () => {
	it("splits net into clearing, withdrawn, pending and withdrawable (spec test 5)", () => {
		const f = teacherFinance(
			[sale(2000, 30), sale(1000, 3), sale(1500, 40, "refunded")],
			[withdrawal(500, "approved"), withdrawal(600, "pending")],
			NOW,
		);
		expect(f.teacherNet).toBe(1800 + 900);
		expect(f.pendingClearance).toBe(900);
		expect(f.withdrawn).toBe(500);
		expect(f.pendingWithdrawals).toBe(600);
		expect(f.withdrawable).toBe(700);
		expect(balanceAddsUp(f)).toBe(f.teacherNet);
	});

	it("keeps a sale in clearance for exactly 7 days", () => {
		const justInside = teacherFinance([sale(1000, 6.99)], [], NOW);
		const justOutside = teacherFinance([sale(1000, 7.01)], [], NOW);
		expect(justInside.pendingClearance).toBe(900);
		expect(justInside.withdrawable).toBe(0);
		expect(justOutside.pendingClearance).toBe(0);
		expect(justOutside.withdrawable).toBe(900);
	});

	it("a rejected withdrawal returns the amount to withdrawable (spec test 12)", () => {
		const sales = [sale(5000, 30)];
		const pending = teacherFinance(sales, [withdrawal(2000, "pending")], NOW);
		const rejected = teacherFinance(sales, [withdrawal(2000, "rejected")], NOW);
		expect(pending.withdrawable).toBe(4500 - 2000);
		expect(rejected.withdrawable).toBe(4500);
		expect(rejected.pendingWithdrawals).toBe(0);
	});

	it("never reports a negative withdrawable balance", () => {
		const f = teacherFinance(
			[sale(1000, 30)],
			[withdrawal(5000, "approved")],
			NOW,
		);
		expect(f.withdrawable).toBe(0);
	});

	it("refunded sales don't count toward any balance", () => {
		const f = teacherFinance([sale(1000, 2, "refunded")], [], NOW);
		expect(f).toMatchObject({
			teacherNet: 0,
			pendingClearance: 0,
			withdrawable: 0,
		});
	});
});

describe("platformSummary", () => {
	it("revenue = commission + registration fees", () => {
		const s = platformSummary(
			[sale(1000, 5), sale(2000, 50)],
			[{ amount: 300 }, { amount: 300 }],
		);
		expect(s.totals.commission).toBe(300);
		expect(s.registrationFees).toEqual({ total: 600, count: 2 });
		expect(s.platformRevenue).toBe(900);
	});
});

describe("monthlySeries", () => {
	it("returns the last 6 months, current month last", () => {
		const months = monthlySeries([], NOW).map((p) => p.month);
		expect(months).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
	});

	it("groups completed sales by month and skips refunds", () => {
		const series = monthlySeries(
			[sale(1000, 1), sale(500, 2), sale(700, 3, "refunded"), sale(2000, 40)],
			NOW,
		);
		expect(series.at(-1)).toEqual({
			month: "Oct",
			gross: 1500,
			commission: 150,
			net: 1350,
			sales: 2,
		});
		expect(series.at(-2)).toEqual({
			month: "Sep",
			gross: 2000,
			commission: 200,
			net: 1800,
			sales: 1,
		});
	});

	it("uses Asia/Dhaka month boundaries", () => {
		const now = Date.UTC(2026, 10, 15); // mid-November
		const at = (iso: string): SaleRow => ({
			...sale(1000, 0),
			createdAt: new Date(iso),
		});
		const series = monthlySeries(
			[
				at("2026-10-31T17:59:00Z"), // 23:59 on 31 Oct in Dhaka -> October
				at("2026-10-31T18:00:00Z"), // 00:00 on 1 Nov in Dhaka -> November
			],
			now,
		);
		expect(series.at(-1)).toMatchObject({ month: "Nov", sales: 1 });
		expect(series.at(-2)).toMatchObject({ month: "Oct", sales: 1 });
	});

	it("crosses the year boundary", () => {
		const months = monthlySeries([], Date.UTC(2027, 1, 10), 4).map(
			(p) => p.month,
		);
		expect(months).toEqual(["Nov", "Dec", "Jan", "Feb"]);
	});
});
