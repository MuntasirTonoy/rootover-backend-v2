// Home page picks (admins feature teachers; featured courses are just the most
// popular ones) and teachers seeing the courses they bought before becoming
// teachers. Everything is restored after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
let admin: string;
let teacher: { id: string; featured: boolean };
const startedAt = new Date();

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	admin = await tokenFor("u-admin");
	teacher = await prisma.teacherProfile.findFirstOrThrow({
		where: {
			user: { status: "active" },
			courses: { some: { status: "approved" } },
		},
		select: { id: true, featured: true },
	});
});

afterAll(async () => {
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

const feature = (id: string, featured: boolean, token = admin) =>
	call(`/admin/teachers/${id}/featured`, {
		method: "PATCH",
		token,
		body: { featured },
	});

describe("featured teachers", () => {
	it("are admin-only, and courses can't be featured by hand", async () => {
		expect(
			(await feature(teacher.id, true, await tokenFor("u-t1"))).status,
		).toBe(403);
		const course = await call("/admin/courses/c-ssc-physics/featured", {
			method: "PATCH",
			token: admin,
			body: { featured: true },
		});
		expect(course.status).toBe(404);
	});

	it("a featured teacher shows in /teachers?featured=true", async () => {
		await feature(teacher.id, false);
		const ids = async () =>
			(await call("/teachers?featured=true")).body.map(
				(t: { id: string; featured: boolean }) => t.id,
			);
		expect(await ids()).not.toContain(teacher.id);
		const r = await feature(teacher.id, true);
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
		// Watching moves the "continue learning" position: put it back afterwards
		const enrollment = await prisma.enrollment.findFirstOrThrow({
			where: { studentId: "u-s1", courseId: course.id },
			select: { id: true, lastLessonId: true, lastWatchedAt: true },
		});
		try {
			expect(
				(
					await call(`/learn/${course.id}/lessons/${lesson.id}/watch`, {
						method: "POST",
						token,
					})
				).status,
			).toBe(204);
		} finally {
			await prisma.enrollment.update({
				where: { id: enrollment.id },
				data: {
					lastLessonId: enrollment.lastLessonId,
					lastWatchedAt: enrollment.lastWatchedAt,
				},
			});
		}
	});
});
