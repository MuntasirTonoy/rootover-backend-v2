// Admin-editable platform fees (not in the spec; user's request, 2026-10-26):
// the sale commission and the teacher registration fee. A change needs a
// 6-digit code emailed to the admin making it (OtpPurpose admin_settings).
// Purchases and fees copy the amounts when they're made, so a change only
// affects new sales and new fee payments.
import httpStatus from "http-status";
import type { Prisma, User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import { sendMail } from "../../lib/mailer.js";
import prisma from "../../lib/prisma.js";
import { logActivity } from "../../utils/activity.js";
import {
	DEFAULT_COMMISSION_RATE,
	DEFAULT_REGISTRATION_FEE,
} from "../../utils/pricing.js";
import {
	consumeOtp,
	cooldownLeft,
	issueOtp,
	OTP_RESEND_COOLDOWN_SECONDS,
} from "../auth/auth.otp.js";
import { settingsCodeEmail } from "./settings.emails.js";

type Db = Prisma.TransactionClient | typeof prisma;

export interface PlatformFees {
	commissionRate: number;
	registrationFee: number;
}

export interface SettingsChange {
	commissionPercent: number;
	registrationFee: number;
}

const ID = "default";

// Read on every price quote and fee payment; cached briefly so a busy catalog
// doesn't hit the database for one row. Saving clears it on this instance;
// other instances pick the change up within the TTL.
const CACHE_MS = 30_000;
let cache: { at: number; value: PlatformFees } | null = null;

const load = async (db: Db): Promise<PlatformFees> => {
	const row = await db.platformSettings.upsert({
		where: { id: ID },
		create: {
			id: ID,
			commissionRate: DEFAULT_COMMISSION_RATE,
			registrationFee: DEFAULT_REGISTRATION_FEE,
		},
		update: {},
	});
	return {
		commissionRate: row.commissionRate,
		registrationFee: row.registrationFee,
	};
};

// Pass a transaction client to read the value a write depends on uncached
const get = async (db?: Db): Promise<PlatformFees> => {
	if (db) return load(db);
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
	const value = await load(prisma);
	cache = { at: Date.now(), value };
	return value;
};

// Percent with at most 2 decimals, so 12.5% stays 0.125 and never 0.12500000001
const toRate = (percent: number) => Math.round(percent * 100) / 10_000;
const toPercent = (rate: number) => Math.round(rate * 10_000) / 100;

// GET /api/admin/settings
const view = async () => {
	const fees = await get(prisma);
	const row = await prisma.platformSettings.findUniqueOrThrow({
		where: { id: ID },
	});
	const by = row.updatedById
		? await prisma.user.findUnique({
				where: { id: row.updatedById },
				select: { name: true },
			})
		: null;
	return {
		commissionPercent: toPercent(fees.commissionRate),
		registrationFee: fees.registrationFee,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: by?.name,
	};
};

const describe = (fees: PlatformFees) =>
	`commission ${toPercent(fees.commissionRate)}%, registration fee ৳${fees.registrationFee}`;

// POST /api/admin/settings/code: emails a code that confirms this change
const requestCode = async (admin: User, change: SettingsChange) => {
	const current = await get(prisma);
	if (
		toRate(change.commissionPercent) === current.commissionRate &&
		change.registrationFee === current.registrationFee
	)
		throw new AppError(
			httpStatus.UNPROCESSABLE_ENTITY,
			"Nothing changed: these are the current settings.",
		);
	const wait = await cooldownLeft(admin.id, "admin_settings");
	if (wait > 0)
		throw new AppError(
			httpStatus.TOO_MANY_REQUESTS,
			`Wait ${wait} seconds before requesting another code.`,
		);
	const { id, code } = await issueOtp(admin, "admin_settings");
	try {
		await sendMail(
			settingsCodeEmail(admin.email, admin.name, code, {
				commission: [
					toPercent(current.commissionRate),
					change.commissionPercent,
				],
				registrationFee: [current.registrationFee, change.registrationFee],
			}),
		);
	} catch (err) {
		// No code without a delivered email, so the admin can ask again right away
		await prisma.emailOtp.delete({ where: { id } }).catch(() => undefined);
		throw err;
	}
	return { email: admin.email, resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS };
};

// PUT /api/admin/settings: the code from the email confirms the change
const save = async (admin: User, change: SettingsChange & { code: string }) => {
	await consumeOtp(admin.id, "admin_settings", change.code);
	const next: PlatformFees = {
		commissionRate: toRate(change.commissionPercent),
		registrationFee: change.registrationFee,
	};
	await prisma.$transaction(async (tx) => {
		const before = await load(tx);
		await tx.platformSettings.update({
			where: { id: ID },
			data: { ...next, updatedById: admin.id },
		});
		await logActivity(
			tx,
			admin,
			"Changed platform settings",
			`${describe(before)} → ${describe(next)}`,
		);
	});
	cache = null;
	return view();
};

export const SettingsService = { get, view, requestCode, save };
