// Database loaders for the pure finance functions in ./finance.ts
import type { Prisma } from "../../generated/prisma/client.js";
import type prisma from "../lib/prisma.js";
import { teacherFinance } from "./finance.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const saleRowSelect = {
	status: true,
	listPrice: true,
	amountPaid: true,
	commission: true,
	teacherNet: true,
	createdAt: true,
} as const;

// Pass the transaction client when the balance guards a write (e.g. a
// withdrawal request), so the check and the write see the same data
export async function loadTeacherFinance(
	db: Db,
	teacherId: string,
	now = Date.now(),
) {
	const purchases = await db.purchase.findMany({
		where: { teacherId },
		select: saleRowSelect,
	});
	const withdrawals = await db.withdrawal.findMany({
		where: { teacherId },
		select: { status: true, amount: true },
	});
	return teacherFinance(purchases, withdrawals, now);
}

// Every teacher's balance at once (admin lists and reports), from two queries
export async function loadAllTeacherFinances(db: Db, now = Date.now()) {
	const [purchases, withdrawals] = await Promise.all([
		db.purchase.findMany({ select: { ...saleRowSelect, teacherId: true } }),
		db.withdrawal.findMany({
			select: { teacherId: true, status: true, amount: true },
		}),
	]);
	return (teacherId: string) =>
		teacherFinance(
			purchases.filter((p) => p.teacherId === teacherId),
			withdrawals.filter((w) => w.teacherId === teacherId),
			now,
		);
}
