// Seeds the demo dataset (BACKEND_SPEC section 16). Idempotent: every run wipes
// all tables and recreates the same data, so it can be re-run at any time.
//
//   npm run db:seed
//
// Demo logins: admin@rootover.demo / Admin@123, teacher@rootover.demo /
// Teacher@123, student@rootover.demo / Student@123; every other seeded user
// uses Demo@123. Only bcrypt hashes are stored.
import config from "../src/config/index.js";
import { Prisma } from "../src/generated/prisma/client.js";
import prisma, { dbSchema } from "../src/app/lib/prisma.js";
import { hashPassword } from "../src/app/modules/auth/auth.utils.js";
import { buildSeedData } from "./seed/data.js";

const args = new Set(process.argv.slice(2));

if (config.env === "production" && !args.has("--force")) {
	console.error(
		"Refusing to wipe a production database. Re-run with --force if you really mean it.",
	);
	process.exit(1);
}

async function main() {
	const data = buildSeedData();

	// Only four distinct demo passwords, so hash each once
	const hashes = new Map<string, string>();
	for (const password of new Set(data.users.map((u) => u.password)))
		hashes.set(password, await hashPassword(password));

	const lessons = data.courses.flatMap((c) =>
		c.chapters.flatMap((ch) =>
			ch.lessons.map((l) => ({ ...l, chapterId: ch.id })),
		),
	);

	// Connect first: a suspended Neon compute can take a while to wake up, and
	// that must not eat into the transaction's maxWait
	await prisma.$queryRaw`SELECT 1`;

	await prisma.$transaction(
		async (tx) => {
			// Wipe everything (CASCADE handles foreign keys)
			// Schema-qualified, like every ORM query (see src/app/lib/prisma.ts)
			const tables = Object.values(Prisma.ModelName)
				.map((name) => `"${dbSchema}"."${name}"`)
				.join(", ");
			await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);

			await tx.user.createMany({
				data: data.users.map(({ password, ...u }) => ({
					...u,
					passwordHash: hashes.get(password) ?? "!",
					// Demo accounts are pre-verified so their logins work straight away
					emailVerifiedAt: u.createdAt,
					updatedAt: u.createdAt,
				})),
			});
			await tx.teacherProfile.createMany({ data: data.teachers });
			await tx.teacherApplication.createMany({ data: data.applications });
			await tx.registrationFee.createMany({ data: data.registrationFees });
			await tx.course.createMany({
				data: data.courses.map(({ chapters: _c, reviews: _r, ...c }) => c),
			});
			await tx.chapter.createMany({
				data: data.courses.flatMap((c) =>
					c.chapters.map(({ lessons: _l, ...ch }) => ({
						...ch,
						courseId: c.id,
					})),
				),
			});
			await tx.lesson.createMany({ data: lessons });
			await tx.review.createMany({
				data: data.courses.flatMap((c) => c.reviews),
			});
			await tx.coupon.createMany({ data: data.coupons });
			await tx.purchase.createMany({ data: data.purchases });
			await tx.enrollment.createMany({
				data: data.enrollments.map(({ completedLessonIds: _c, ...e }) => e),
			});
			await tx.lessonCompletion.createMany({
				data: data.enrollments.flatMap((e) =>
					e.completedLessonIds.map((lessonId) => ({
						enrollmentId: e.id,
						lessonId,
						completedAt: e.lastWatchedAt ?? e.enrolledAt,
					})),
				),
			});
			await tx.savedLesson.createMany({ data: data.savedLessons });
			await tx.withdrawal.createMany({ data: data.withdrawals });
			await tx.videoReport.createMany({
				data: data.videoReports.map(({ events: _e, ...r }) => r),
			});
			await tx.videoReportEvent.createMany({
				data: data.videoReports.flatMap((r) =>
					r.events.map((e) => ({ ...e, reportId: r.id })),
				),
			});
			await tx.activityLog.createMany({ data: data.activityLogs });
		},
		{ maxWait: 30_000, timeout: 120_000 },
	);

	const counts = {
		users: data.users.length,
		teachers: data.teachers.length,
		applications: data.applications.length,
		courses: data.courses.length,
		lessons: lessons.length,
		purchases: data.purchases.length,
		enrollments: data.enrollments.length,
		coupons: data.coupons.length,
		withdrawals: data.withdrawals.length,
		videoReports: data.videoReports.length,
		activityLogs: data.activityLogs.length,
	};
	console.log("Seeded:", counts);
	const login = (id: string) => {
		const u = data.users.find((x) => x.id === id);
		return u ? `${u.email} / ${u.password}` : id;
	};
	console.log(
		`Demo logins: ${login("u-admin")} · ${login("u-t1")} · ${login("u-s1")} (others: Demo@123)`,
	);
}

main()
	.catch((err) => {
		console.error("Seed failed:", err);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
