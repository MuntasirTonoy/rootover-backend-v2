// Public catalog, course details, teachers and free previews against the seeded
// database (spec section 10.2, section 7 access rules, spec tests 8 and 11 part).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let get: ReturnType<typeof api>;
const tokens: Record<string, string> = {};

beforeAll(async () => {
	app = startApp();
	get = api(app.base);
	for (const id of ["u-s1", "u-t1", "u-t2", "u-admin"])
		tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await app.close();
	await prisma.$disconnect();
});

const CATALOG = [
	"c-ssc-physics",
	"c-hsc-physics",
	"c-hsc-chemistry",
	"c-bsc-organic",
	"c-bsc-calculus",
	"c-other-c",
	"c-bba-accounting",
	"c-ba-english",
];
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe("GET /api/courses", () => {
	it("lists only catalog courses, most popular first, with summary fields", async () => {
		const { status, body } = await get("/courses?limit=100");
		expect(status).toBe(200);
		expect(ids(body.data).sort()).toEqual([...CATALOG].sort());
		expect(body.pagination).toEqual({
			page: 1,
			limit: 100,
			total: 8,
			pages: 1,
		});
		const counts = body.data.map(
			(c: { studentCount: number }) => c.studentCount,
		);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
		const physics = body.data.find(
			(c: { id: string }) => c.id === "c-ssc-physics",
		);
		expect(physics).toMatchObject({
			price: 1500,
			discountPrice: 1200,
			effectivePrice: 1200,
			discountPercent: 20,
			teacher: { id: "t1", name: "Dr. Rezaul Karim" },
			lessonCount: 12,
			chapterCount: 4,
			featured: true,
		});
		expect(physics.rating.count).toBeGreaterThan(0);
		// Summaries never carry lesson links
		expect(JSON.stringify(body)).not.toContain("youtube.com");
	});

	it("searches title, subject, level and teacher name, case-insensitively", async () => {
		expect(ids((await get("/courses?q=PHYSICS")).body.data).sort()).toEqual([
			"c-hsc-physics",
			"c-ssc-physics",
		]);
		expect(ids((await get("/courses?q=karim")).body.data).sort()).toEqual([
			"c-hsc-physics",
			"c-ssc-physics",
		]);
		expect(ids((await get("/courses?q=bba")).body.data)).toEqual([
			"c-bba-accounting",
		]);
		expect((await get("/courses?q=zzzz-nothing")).body.data).toEqual([]);
	});

	it("filters by level, subject, teacher, featured and price range", async () => {
		expect(ids((await get("/courses?level=HSC")).body.data).sort()).toEqual([
			"c-hsc-chemistry",
			"c-hsc-physics",
		]);
		expect(
			ids((await get("/courses?subject=physics")).body.data).sort(),
		).toEqual(["c-hsc-physics", "c-ssc-physics"]);
		expect(ids((await get("/courses?teacherId=t3")).body.data).sort()).toEqual([
			"c-bsc-calculus",
			"c-other-c",
		]);
		for (const c of (await get("/courses?featured=true")).body.data)
			expect(c.featured).toBe(true);
		const price = async (range: string) =>
			(await get(`/courses?price=${range}&limit=100`)).body.data.map(
				(c: { effectivePrice: number }) => c.effectivePrice,
			);
		for (const p of await price("under1000")) expect(p).toBeLessThan(1000);
		for (const p of await price("1000-2000"))
			expect(p >= 1000 && p <= 2000).toBe(true);
		for (const p of await price("over2000")) expect(p).toBeGreaterThan(2000);
		expect(
			(await price("under1000")).length +
				(await price("1000-2000")).length +
				(await price("over2000")).length,
		).toBe(8);
	});

	it("sorts by price, rating and newest", async () => {
		const prices = (
			await get("/courses?sort=price-asc&limit=100")
		).body.data.map((c: { effectivePrice: number }) => c.effectivePrice);
		expect(prices).toEqual([...prices].sort((a, b) => a - b));
		const desc = (
			await get("/courses?sort=price-desc&limit=100")
		).body.data.map((c: { effectivePrice: number }) => c.effectivePrice);
		expect(desc).toEqual([...prices].reverse());
		const ratings = (await get("/courses?sort=rating&limit=100")).body.data.map(
			(c: { rating: { average: number } }) => c.rating.average,
		);
		expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
		const dates = (await get("/courses?sort=newest&limit=100")).body.data.map(
			(c: { createdAt: string }) => c.createdAt,
		);
		expect(dates).toEqual([...dates].sort().reverse());
	});

	it("paginates without overlaps", async () => {
		const pages = await Promise.all(
			[1, 2, 3].map((p) => get(`/courses?limit=3&page=${p}`)),
		);
		expect(pages[2].body.pagination).toEqual({
			page: 3,
			limit: 3,
			total: 8,
			pages: 3,
		});
		expect(pages[2].body.data).toHaveLength(2);
		const all = pages.flatMap((p) => ids(p.body.data));
		expect(new Set(all).size).toBe(8);
	});

	it("rejects bad query values", async () => {
		expect((await get("/courses?sort=cheapest")).status).toBe(400);
		expect((await get("/courses?limit=500")).body.error.fields.limit).toBe(
			"limit can be at most 100.",
		);
		expect((await get("/courses?level=PhD")).status).toBe(400);
	});
});

describe("GET /api/courses/facets", () => {
	it("returns every level with its count, subjects and teachers", async () => {
		const { body } = await get("/courses/facets");
		expect(body.levels.map((l: { level: string }) => l.level)).toEqual([
			"SSC",
			"HSC",
			"BSc",
			"BBA",
			"BA",
			"Others",
		]);
		expect(
			body.levels.reduce((s: number, l: { count: number }) => s + l.count, 0),
		).toBe(8);
		expect(body.subjects).toEqual(
			[...body.subjects].sort((a: string, b: string) => a.localeCompare(b)),
		);
		expect(body.subjects).not.toContain("Higher Mathematics"); // pending course
		expect(body.teachers).toHaveLength(4);
	});
});

describe("GET /api/courses/:id (lesson access, spec test 8)", () => {
	it("guests see previews only; locked lessons have no video or notes link", async () => {
		const { status, body } = await get("/courses/c-ssc-physics");
		expect(status).toBe(200);
		expect(body).toMatchObject({
			published: true,
			status: "approved",
			access: { enrolled: false, owner: false, full: false },
		});
		expect(body.enrollment).toBeUndefined();
		const lessons = body.chapters.flatMap(
			(ch: { lessons: unknown[] }) => ch.lessons,
		);
		const preview = lessons.filter((l: { isPreview: boolean }) => l.isPreview);
		expect(preview).toHaveLength(1);
		expect(preview[0]).toMatchObject({
			canWatch: true,
			videoUrl: expect.stringContaining("youtube.com/embed/"),
			noteLink: expect.stringContaining("https://"),
		});
		for (const l of lessons.filter((x: { isPreview: boolean }) => !x.isPreview))
			expect(l).toMatchObject({
				canWatch: false,
				videoUrl: null,
				noteLink: null,
			});
		expect(body.teacher).toMatchObject({
			id: "t1",
			teacherCode: "RO-T-26-0101",
			status: "active",
		});
		expect(body.teacher.stats.courses).toBe(2);
		expect(body.reviews.length).toBeGreaterThan(0);
	});

	it("an enrolled student gets every lesson plus progress and the resume lesson", async () => {
		const { body } = await get("/courses/c-ssc-physics", {
			token: tokens["u-s1"],
		});
		expect(body.access).toEqual({ enrolled: true, owner: false, full: true });
		const lessons = body.chapters.flatMap(
			(ch: { lessons: { canWatch: boolean; videoUrl: string | null }[] }) =>
				ch.lessons,
		);
		expect(
			lessons.every(
				(l: { canWatch: boolean; videoUrl: string | null }) =>
					l.canWatch && l.videoUrl,
			),
		).toBe(true);
		expect(body.enrollment.progress).toEqual({
			completed: 7,
			total: 12,
			percent: 58,
		});
		expect(body.enrollment.resumeLessonId).toBe("c-ssc-physics-ch3-l2");
	});

	it("the same student is locked out of a course they don't own", async () => {
		const { body } = await get("/courses/c-bsc-calculus", {
			token: tokens["u-s1"],
		});
		expect(body.access.full).toBe(false);
		expect(body.chapters[1].lessons[0].videoUrl).toBeNull();
	});

	it("unpublished courses are 404 except to their owner and admins", async () => {
		expect((await get("/courses/c-hsc-highermath")).status).toBe(404);
		expect(
			(await get("/courses/c-ssc-math", { token: tokens["u-s1"] })).status,
		).toBe(404);
		expect(
			(await get("/courses/c-hsc-highermath", { token: tokens["u-t2"] }))
				.status,
		).toBe(404);
		const owner = await get("/courses/c-hsc-highermath", {
			token: tokens["u-t1"],
		});
		expect(owner.status).toBe(200);
		expect(owner.body).toMatchObject({
			published: false,
			status: "pending",
			access: { owner: true, full: true },
		});
		const admin = await get("/courses/c-ssc-math", {
			token: tokens["u-admin"],
		});
		expect(admin.body).toMatchObject({
			published: false,
			status: "draft",
			access: { full: true },
		});
		expect((await get("/courses/does-not-exist")).body.error).toEqual({
			code: "NOT_FOUND",
			message: "Course not found.",
		});
	});

	it("an invalid token is treated as a guest", async () => {
		const { status, body } = await get("/courses/c-ssc-physics", {
			token: "garbage",
		});
		expect(status).toBe(200);
		expect(body.access.full).toBe(false);
	});
});

describe("banning a teacher hides their courses (spec test 11 part)", () => {
	it("disappear from the catalog, details and teachers, then come back", async () => {
		await prisma.user.update({
			where: { id: "u-t4" },
			data: { status: "banned" },
		});
		try {
			expect(ids((await get("/courses?limit=100")).body.data)).not.toContain(
				"c-bba-accounting",
			);
			expect((await get("/courses/c-bba-accounting")).status).toBe(404);
			expect((await get("/teachers/t4")).status).toBe(404);
			expect(ids(await (await get("/teachers")).body)).not.toContain("t4");
			// The admin still sees it, marked unpublished
			expect(
				(await get("/courses/c-bba-accounting", { token: tokens["u-admin"] }))
					.body.published,
			).toBe(false);
		} finally {
			await prisma.user.update({
				where: { id: "u-t4" },
				data: { status: "active" },
			});
		}
		expect(ids((await get("/courses?limit=100")).body.data)).toContain(
			"c-bba-accounting",
		);
	});
});

describe("GET /api/teachers", () => {
	it("lists active teachers with catalog courses, most students first", async () => {
		const { body } = await get("/teachers");
		expect(body).toHaveLength(4);
		const students = body.map(
			(t: { stats: { students: number } }) => t.stats.students,
		);
		expect(students).toEqual([...students].sort((a, b) => b - a));
		const karim = body.find((t: { id: string }) => t.id === "t1");
		expect(karim).toMatchObject({
			name: "Dr. Rezaul Karim",
			teacherCode: "RO-T-26-0101",
			stats: { courses: 2 },
		});
		expect(karim.stats.rating).toBeGreaterThan(0);
		expect(JSON.stringify(body)).not.toMatch(/email|passwordHash/);
	});

	it("searches name, headline and course subjects", async () => {
		expect(ids((await get("/teachers?q=chemistry")).body)).toEqual(["t2"]);
		expect(ids((await get("/teachers?q=mentor")).body)).toEqual(["t3"]);
		expect(ids((await get("/teachers?q=farzana")).body)).toEqual(["t4"]);
	});

	it("GET /teachers/:id returns the profile and only catalog courses", async () => {
		const { body } = await get("/teachers/t1");
		expect(body.teacher.id).toBe("t1");
		expect(ids(body.courses).sort()).toEqual([
			"c-hsc-physics",
			"c-ssc-physics",
		]);
		expect((await get("/teachers/nope")).status).toBe(404);
	});
});

describe("GET /api/free-previews", () => {
	it("returns the preview lessons of catalog courses, with their links", async () => {
		const { body } = await get("/free-previews");
		expect(body).toHaveLength(8);
		expect(
			new Set(body.map((p: { course: { id: string } }) => p.course.id)),
		).toEqual(new Set(CATALOG));
		for (const p of body) {
			expect(p.lesson).toMatchObject({
				isPreview: true,
				canWatch: true,
				videoUrl: expect.stringContaining("youtube.com/embed/"),
			});
			expect(typeof p.chapterTitle).toBe("string");
		}
	});
});
