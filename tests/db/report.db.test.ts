// Video reports end to end (spec section 14). Reports are made by throwaway
// students on c-ssc-physics (teacher t1); everything created here, and the
// activity rows it logged, is deleted afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const tag = Date.now().toString(36);
const startedAt = new Date();
const testUsers: string[] = [];

const PREVIEW = "c-ssc-physics-ch1-l1";
const LOCKED = "c-ssc-physics-ch2-l1";
const reportPath = (lessonId: string) =>
	`/learn/c-ssc-physics/lessons/${lessonId}/reports`;

const newStudent = async (name: string) => {
	const u = await prisma.user.create({
		data: {
			name: `${name} ${tag}`,
			email: `${name.toLowerCase()}-${tag}@report-db.test`,
			passwordHash: "!",
			emailVerifiedAt: new Date(),
		},
	});
	testUsers.push(u.id);
	return { id: u.id, name: u.name, token: await tokenFor(u.id) };
};

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-t1", "u-t2", "u-admin"]) tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.videoReport.deleteMany({
		where: { reporterId: { in: testUsers } },
	});
	await prisma.activityLog.deleteMany({
		where: {
			at: { gte: startedAt },
			OR: [
				{ actorId: { in: [...testUsers, "u-t1", "u-admin"] } },
				{ action: { contains: "video" } },
			],
		},
	});
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
	await app.close();
}, 60_000);

describe("reporting (students)", () => {
	it("validates, checks access and allows one active report per lesson", async () => {
		const s = await newStudent("Reporter");
		const as = (path: string, body?: unknown) =>
			call(path, { method: "POST", token: s.token, body });

		const other = await as(reportPath(PREVIEW), { reason: "OTHER" });
		expect(other.status).toBe(400);
		expect(other.body.error.fields.description).toBe(
			"Please describe the problem.",
		);
		const locked = await as(reportPath(LOCKED), { reason: "VIDEO_ISSUE" });
		expect(locked.status).toBe(403);
		expect(locked.body.error.message).toBe(
			"You can only report lessons you can watch.",
		);
		expect(
			(await as(reportPath("c-hsc-physics-ch1-l1"), { reason: "AUDIO_ISSUE" }))
				.status,
		).toBe(404);
		const teacher = await call(reportPath(PREVIEW), {
			method: "POST",
			token: tokens["u-t1"],
			body: { reason: "VIDEO_ISSUE" },
		});
		expect(teacher.status).toBe(403);
		expect(teacher.body.error.message).toBe("Only students can report videos.");

		// Two at once: exactly one is created
		const both = await Promise.all(
			[0, 1].map(() =>
				as(reportPath(PREVIEW), {
					reason: "AUDIO_ISSUE",
					description: "  No sound after 02:00  ",
				}),
			),
		);
		expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
		const created = both.find((r) => r.status === 201)?.body;
		expect(created).toMatchObject({
			reason: "AUDIO_ISSUE",
			description: "No sound after 02:00",
			status: "open",
			course: { id: "c-ssc-physics" },
			lesson: { id: PREVIEW },
			teacher: { id: "t1" },
			reporter: { id: s.id, name: s.name },
			events: [{ type: "reported", actorName: s.name, actorRole: "student" }],
		});
		expect(created.lesson.videoUrl).toMatch(
			/^https:\/\/www\.youtube\.com\/embed\//,
		);
		expect(created.reporter).not.toHaveProperty("email");
		expect(both.find((r) => r.status === 409)?.body.error.message).toBe(
			"You've already reported this video. We'll update you when it's fixed.",
		);

		const player = await call("/learn/c-ssc-physics", { token: s.token });
		expect(player.body.myOpenReportLessonIds).toEqual([PREVIEW]);
		const mine = await call("/me/video-reports", { token: s.token });
		expect(mine.body.map((r: { id: string }) => r.id)).toEqual([created.id]);
	});
});

describe("fixing and reviewing", () => {
	it("runs open -> fix -> reject -> fix -> approve, with history and rules", async () => {
		const s = await newStudent("Lifecycle");
		const r = await call(reportPath(PREVIEW), {
			method: "POST",
			token: s.token,
			body: { reason: "BROKEN_LINK" },
		});
		const id = r.body.id;
		const t1 = (path: string, body?: unknown) =>
			call(path, { method: "POST", token: tokens["u-t1"], body });
		const admin = (path: string, body?: unknown) =>
			call(path, { method: "POST", token: tokens["u-admin"], body });

		// Admin can't approve an open report; the teacher's note is validated;
		// another teacher can't see it
		expect((await admin(`/admin/video-reports/${id}/approve-fix`)).status).toBe(
			422,
		);
		const short = await t1(`/teacher/reports/${id}/submit-fix`, { note: "ok" });
		expect(short.status).toBe(400);
		expect(short.body.error.fields.note).toBe("Describe what you fixed.");
		const foreign = await call(`/teacher/reports/${id}/submit-fix`, {
			method: "POST",
			token: tokens["u-t2"],
			body: { note: "Fixed the link." },
		});
		expect(foreign.status).toBe(404);

		const board = await call("/teacher/reports?status=action&limit=100", {
			token: tokens["u-t1"],
		});
		expect(board.body.data.map((x: { id: string }) => x.id)).toContain(id);
		expect(board.body.counts.needsFix).toBeGreaterThan(0);

		let fix = await t1(`/teacher/reports/${id}/submit-fix`, {
			note: "Replaced the private video.",
		});
		expect(fix.body).toMatchObject({
			status: "fix_submitted",
			teacherNote: "Replaced the private video.",
		});
		expect(fix.body.fixSubmittedAt).toBeTruthy();
		expect(
			(await t1(`/teacher/reports/${id}/submit-fix`, { note: "Again please" }))
				.status,
		).toBe(422);

		const adminBoard = await call(
			"/admin/video-reports?status=action&limit=100",
			{
				token: tokens["u-admin"],
			},
		);
		expect(adminBoard.body.data[0].status).toBe("fix_submitted");

		const noReason = await admin(`/admin/video-reports/${id}/reject-fix`, {});
		expect(noReason.status).toBe(400);
		const rejected = await admin(`/admin/video-reports/${id}/reject-fix`, {
			reason: "Still private for me.",
		});
		expect(rejected.body).toMatchObject({
			status: "fix_rejected",
			adminNote: "Still private for me.",
		});

		fix = await t1(`/teacher/reports/${id}/submit-fix`, {
			note: "Made the video unlisted.",
		});
		expect(fix.body.status).toBe("fix_submitted");
		const approved = await admin(`/admin/video-reports/${id}/approve-fix`);
		expect(approved.body).toMatchObject({ status: "resolved" });
		expect(approved.body.resolvedAt).toBeTruthy();
		expect(approved.body.events.map((e: { type: string }) => e.type)).toEqual([
			"reported",
			"fix_submitted",
			"fix_rejected",
			"fix_submitted",
			"fix_approved",
		]);
		// resolved is final; teachers can't use the admin endpoints
		expect(
			(
				await admin(`/admin/video-reports/${id}/reject-fix`, {
					reason: "Changed my mind",
				})
			).status,
		).toBe(422);
		expect((await t1(`/admin/video-reports/${id}/approve-fix`)).status).toBe(
			403,
		);

		const logs = await prisma.activityLog.findMany({
			where: {
				at: { gte: startedAt },
				target: "SSC Physics: Complete Course · " + approved.body.lesson.title,
				actorId: { in: [s.id, "u-t1", "u-admin"] },
			},
		});
		expect(logs.map((l) => l.action).sort()).toEqual([
			"Approved a video fix",
			"Rejected a video fix",
			"Reported a video",
			"Submitted a video fix",
			"Submitted a video fix",
		]);

		// After it's resolved the student may report the lesson again
		const again = await call(reportPath(PREVIEW), {
			method: "POST",
			token: s.token,
			body: { reason: "VIDEO_ISSUE" },
		});
		expect(again.status).toBe(201);
		// Many Neon round trips
	}, 120_000);
});
