// Derived money figures (BACKEND_SPEC section 6). Pure functions over plain
// rows, ported from the frontend's src/lib/selectors.ts, so they can be unit
// tested without a database. Refunded purchases never count toward totals.
import { CLEARING_DAYS } from "./pricing.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// The fields of a Purchase these calculations read
export interface SaleRow {
	status: "completed" | "refunded";
	listPrice: number;
	amountPaid: number;
	commission: number;
	teacherNet: number;
	createdAt: Date;
}

export interface WithdrawalRow {
	status: "pending" | "approved" | "rejected";
	amount: number;
}

export interface SalesTotals {
	sales: number;
	listTotal: number;
	discounts: number;
	gross: number;
	commission: number;
	teacherNet: number;
	refunds: number;
	refundedCount: number;
}

export interface TeacherFinance extends SalesTotals {
	pendingClearance: number;
	withdrawn: number;
	pendingWithdrawals: number;
	withdrawable: number;
}

export interface MonthPoint {
	month: string;
	gross: number;
	commission: number;
	net: number;
	sales: number;
}

const sumBy = <T>(items: T[], pick: (item: T) => number) =>
	items.reduce((sum, item) => sum + pick(item), 0);

export const completedSales = <T extends Pick<SaleRow, "status">>(rows: T[]) =>
	rows.filter((p) => p.status === "completed");

// Gross = what students paid. Discounts = list price minus paid.
export function salesTotals(purchases: SaleRow[]): SalesTotals {
	const done = completedSales(purchases);
	const refunded = purchases.filter((p) => p.status === "refunded");
	const listTotal = sumBy(done, (p) => p.listPrice);
	const gross = sumBy(done, (p) => p.amountPaid);
	return {
		sales: done.length,
		listTotal,
		discounts: listTotal - gross,
		gross,
		commission: sumBy(done, (p) => p.commission),
		teacherNet: sumBy(done, (p) => p.teacherNet),
		refunds: sumBy(refunded, (p) => p.amountPaid),
		refundedCount: refunded.length,
	};
}

// One teacher's balance from their own purchases and withdrawals:
// teacherNet = pendingClearance + withdrawn + pendingWithdrawals + withdrawable
// (withdrawable is clamped at 0). A rejected withdrawal simply stops counting.
export function teacherFinance(
	purchases: SaleRow[],
	withdrawals: WithdrawalRow[],
	now = Date.now(),
): TeacherFinance {
	const totals = salesTotals(purchases);
	const cutoff = now - CLEARING_DAYS * DAY_MS;
	const pendingClearance = sumBy(
		completedSales(purchases).filter((p) => p.createdAt.getTime() > cutoff),
		(p) => p.teacherNet,
	);
	const withdrawn = sumBy(
		withdrawals.filter((w) => w.status === "approved"),
		(w) => w.amount,
	);
	const pendingWithdrawals = sumBy(
		withdrawals.filter((w) => w.status === "pending"),
		(w) => w.amount,
	);
	return {
		...totals,
		pendingClearance,
		withdrawn,
		pendingWithdrawals,
		withdrawable: Math.max(
			0,
			totals.teacherNet - pendingClearance - withdrawn - pendingWithdrawals,
		),
	};
}

// Platform revenue = commission on sales + teacher registration fees
export function platformSummary(
	purchases: SaleRow[],
	registrationFees: { amount: number }[],
) {
	const totals = salesTotals(purchases);
	const feesTotal = sumBy(registrationFees, (f) => f.amount);
	return {
		totals,
		registrationFees: { total: feesTotal, count: registrationFees.length },
		platformRevenue: totals.commission + feesTotal,
	};
}

// Month boundaries follow Asia/Dhaka (UTC+6 all year, no daylight saving), so a
// sale at 01:00 on the 1st in Dhaka belongs to the new month on every server.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

const dhakaMonthIndex = (time: number) => {
	const d = new Date(time + DHAKA_OFFSET_MS);
	return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

// The last `months` calendar months, current month last
export function monthlySeries(
	purchases: SaleRow[],
	now = Date.now(),
	months = 6,
): MonthPoint[] {
	const current = dhakaMonthIndex(now);
	const done = completedSales(purchases);
	const points: MonthPoint[] = [];
	for (let i = months - 1; i >= 0; i--) {
		const index = current - i;
		const inMonth = done.filter(
			(p) => dhakaMonthIndex(p.createdAt.getTime()) === index,
		);
		points.push({
			month: MONTH_NAMES[index % 12],
			gross: sumBy(inMonth, (p) => p.amountPaid),
			commission: sumBy(inMonth, (p) => p.commission),
			net: sumBy(inMonth, (p) => p.teacherNet),
			sales: inMonth.length,
		});
	}
	return points;
}
