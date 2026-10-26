import { describe, expect, it } from "vitest";
import type { Lesson } from "../../src/generated/prisma/client.js";
import {
	courseAccess,
	progressOf,
	ratingOf,
	resumeLessonId,
	toLessonPublic,
} from "../../src/app/modules/course/course.utils.js";

const lesson = (id: string, isPreview = false): Lesson => ({
	id,
	chapterId: "ch1",
	title: id,
	durationMin: 10,
	videoUrl: `https://www.youtube.com/embed/${id.padEnd(11, "x")}`,
	noteLink: `https://example.com/notes/${id}.pdf`,
	isPreview,
	position: 0,
});

describe("ratingOf", () => {
	it("averages to one decimal, 0 with no reviews", () => {
		expect(ratingOf([])).toEqual({ average: 0, count: 0 });
		expect(ratingOf([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({
			average: 4.3,
			count: 3,
		});
		expect(ratingOf([{ rating: 5 }, { rating: 4 }])).toEqual({
			average: 4.5,
			count: 2,
		});
	});
});

describe("courseAccess / toLessonPublic", () => {
	const student = { id: "u1", role: "student" as const };

	it("guests and non-enrolled students only get previews; locked lessons have no links", () => {
		const access = courseAccess(student, {
			enrolled: false,
			ownerUserId: "u-t1",
		});
		expect(access).toEqual({ enrolled: false, owner: false, full: false });
		expect(toLessonPublic(lesson("a", true), access)).toMatchObject({
			canWatch: true,
			noteLink: expect.any(String),
		});
		expect(toLessonPublic(lesson("b"), access)).toMatchObject({
			canWatch: false,
			videoUrl: null,
			noteLink: null,
		});
		expect(
			courseAccess(null, { enrolled: false, ownerUserId: "u-t1" }).full,
		).toBe(false);
	});

	it("enrolled students, the owner and admins get every lesson", () => {
		expect(
			courseAccess(student, { enrolled: true, ownerUserId: "u-t1" }).full,
		).toBe(true);
		expect(
			courseAccess(
				{ id: "u-t1", role: "teacher" },
				{ enrolled: false, ownerUserId: "u-t1" },
			),
		).toEqual({ enrolled: false, owner: true, full: true });
		expect(
			courseAccess(
				{ id: "u-t2", role: "teacher" },
				{ enrolled: false, ownerUserId: "u-t1" },
			).full,
		).toBe(false);
		expect(
			courseAccess(
				{ id: "a", role: "admin" },
				{ enrolled: false, ownerUserId: "u-t1" },
			).full,
		).toBe(true);
	});
});

describe("progressOf / resumeLessonId", () => {
	const ids = ["l1", "l2", "l3", "l4"];

	it("counts only completions of lessons that still exist", () => {
		expect(progressOf(ids, ["l1", "l2", "gone", "l1"])).toEqual({
			completed: 2,
			total: 4,
			percent: 50,
		});
		expect(progressOf([], ["l1"])).toEqual({
			completed: 0,
			total: 0,
			percent: 0,
		});
		expect(progressOf(["a", "b", "c"], ["a"]).percent).toBe(33);
	});

	it("resumes at the last lesson, else the first not completed, else the first", () => {
		expect(resumeLessonId(ids, ["l1"], "l3")).toBe("l3");
		expect(resumeLessonId(ids, ["l1"], "deleted-lesson")).toBe("l2");
		expect(resumeLessonId(ids, [])).toBe("l1");
		expect(resumeLessonId(ids, ids)).toBe("l1");
		expect(resumeLessonId([], [])).toBeUndefined();
	});
});
