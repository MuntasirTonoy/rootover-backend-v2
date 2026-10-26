// Home page picks (admins feature courses and teachers) and teachers seeing the
// courses they bought before becoming teachers. Everything is restored after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
let admin: string;
let live: { id: string; featured: boolean };
let pending: { id: string };
let teacher: { id: string; featured: boolean };
const startedAt = new Date();

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	admin = await tokenFor("u-admin");
	live = await prisma.course.findFirstOrThrow({
		where: { status: "approved", teacher: { user: { status: "active" } } },
		select: { id: true, featured: true },
	});
	pending = await prisma.course.findFirstOrThrow({
		where: { status: { not: "approved" } },
		select: { id: true },
	});
	teacher = await prisma.teacherProfile.findFirstOrThrow({
		where: {
			user: { status: "active" },
			courses: { some: { status: "approved" } },
		},
		select: { id: true, featured: true },
	});
});

afterAll(async () => {
	await prisma.course.update({
		where: { id: live.id },
		data: { featured: live.featured },
	});
	await prisma.teacherProfile.update({
		where: { id: teacher.id },
		data: { featured: teacher.featured },
	});
	await prisma.user.update({
		where: { id: "u-s1" },
		data: { role: "student" },
	});
	await prisma.activityLog.deleteMany({
		where: {
			actorId: "u-admin",
			action: { contains: "eatured" },
			at: { gte: startedAt },
		},
	});
	await app.close();
});

const feature = (kind: "courses" | "teachers", id: string, featured: boolean) =>
	call(`/admin/${kind}/${id}/featured`, {
		method: "PATCH",
		token: admin,
		body: { featured },
	});

describe("featured courses and teachers", () => {
	it("are admin-only", async () => {
		const r = await call(`/admin/courses/${live.id}/featured`, {
			method: "PATCH",
			token: await tokenFor("u-t1"),
			body: { featured: true },
		});
		expect(r.status).toBe(403);
	});

	it("only live courses can be featured", async () => {
		const r = await feature("courses", pending.id, true);
		expect(r.status).toBe(422);
		expect(r.body.error.message).toBe(
			"Only live (approved) courses can be featured.",
		);
	});

	it("a featured course shows in ?featured=true, and leaves it when removed", async () => {
		expect((await feature("courses", live.id, true)).body).toEqual({
			id: live.id,
			featured: true,
		});
		const ids = async () =>
			(await call("/courses?featured=true&limit=50")).body.data.map(
				(c: { id: string }) => c.id,
			);
		expect(await ids()).toContain(live.id);
		await feature("courses", live.id, false);
		expect(await ids()).not.toContain(live.id);
	});

	it("a featured teacher shows in /teachers?featured=true", async () => {
		await feature("teachers", teacher.id, false);
		const ids = async () =>
			(await call("/teachers?featured=true")).body.map(
				(t: { id: string; featured: boolean }) => t.id,
			);
		expect(await ids()).not.toContain(teacher.id);
		const r = await feature("teachers", teacher.id, true);
		expect(r.body.featured).toBe(true);
		expect(await ids()).toContain(teacher.id);
		const all = (await call("/teachers")).body as { id: string }[];
		expect(all.some((t) => t.id === teacher.id)).toBe(true);
	});
});

describe("a teacher's purchased courses", () => {
	it("are listed and keep progress tracking", async () => {
		const asStudent = await call("/me/enrollments", {
			token: await tokenFor("u-s1"),
		});
		expect(asStudent.body.length).toBeGreaterThan(0);
		// The same account after becoming a teacher (roles are reloaded per request)
		await prisma.user.update({
			where: { id: "u-s1" },
			data: { role: "teacher" },
		});
		const token = await tokenFor("u-s1");
		const asTeacher = await call("/me/enrollments", { token });
		expect(asTeacher.status).toBe(200);
		expect(
			asTeacher.body.map((e: { course: { id: string } }) => e.course.id),
		).toEqual(
			asStudent.body.map((e: { course: { id: string } }) => e.course.id),
		);
		const { course } = asTeacher.body[0];
		const lesson = (await call(`/learn/${course.id}`, { token })).body.course
			.chapters[0].lessons[0];
		expect(lesson.canWatch).toBe(true);
		expect(
			(
				await call(`/learn/${course.id}/lessons/${lesson.id}/watch`, {
					method: "POST",
					token,
				})
			).status,
		).toBe(204);
	});
});
