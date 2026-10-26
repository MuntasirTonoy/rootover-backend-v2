// Course ratings: POST /api/learn/:courseId/rating. Only buyers, 1-5 stars,
// once each; only the course's running total and count change, and the
// enrollment's ratedAt records that the student has rated. All restored after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
let student: string;
let teacher: string;
let enrollment: { id: string; courseId: string; ratedAt: Date | null };
let otherCourseId: string;
let totals: { ratingSum: number; ratingCount: number };

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	student = await tokenFor("u-s1");
	teacher = await tokenFor("u-t1");
	enrollment = await prisma.enrollment.findFirstOrThrow({
		where: { studentId: "u-s1", course: { status: "approved" } },
		select: { id: true, courseId: true, ratedAt: true },
	});
	// Start from "not rated yet" whatever the seed says
	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: { ratedAt: null },
	});
	totals = await prisma.course.findUniqueOrThrow({
		where: { id: enrollment.courseId },
		select: { ratingSum: true, ratingCount: true },
	});
	otherCourseId = (
		await prisma.course.findFirstOrThrow({
			where: {
				status: "approved",
				enrollments: { none: { studentId: "u-s1" } },
			},
			select: { id: true },
		})
	).id;
});

afterAll(async () => {
	await prisma.enrollment.update({
		where: { id: enrollment.id },
		data: { ratedAt: enrollment.ratedAt },
	});
	await prisma.course.update({
		where: { id: enrollment.courseId },
		data: totals,
	});
	await app.close();
});

const rate = (courseId: string, token: string, rating: unknown) =>
	call(`/learn/${courseId}/rating`, {
		method: "POST",
		token,
		body: { rating },
	});

describe("course ratings", () => {
	it("rejects ratings outside 1-5", async () => {
		const r = await rate(enrollment.courseId, student, 6);
		expect(r.status).toBe(400);
		expect(r.body.error.fields.rating).toBe(
			"Choose a rating from 1 to 5 stars.",
		);
	});

	it("only lets students who bought the course rate it", async () => {
		expect((await rate(otherCourseId, student, 4)).status).toBe(403);
		expect((await rate(enrollment.courseId, teacher, 4)).status).toBe(403);
	});

	it("counts one rating per buyer, adding only to the course totals", async () => {
		const before = await call(`/courses/${enrollment.courseId}`, {
			token: student,
		});
		expect(before.body.enrollment.rated).toBe(false);

		const first = await rate(enrollment.courseId, student, 2);
		expect(first.status).toBe(200);
		const expected = {
			average:
				Math.round(((totals.ratingSum + 2) / (totals.ratingCount + 1)) * 10) /
				10,
			count: totals.ratingCount + 1,
		};
		expect(first.body.rating).toEqual(expected);

		// Never again, even with another value (or two at once)
		const again = await Promise.all([
			rate(enrollment.courseId, student, 5),
			rate(enrollment.courseId, student, 5),
		]);
		expect(again.map((r) => r.status)).toEqual([409, 409]);
		expect(again[0].body.error.message).toBe(
			"You've already rated this course.",
		);

		const after = await call(`/courses/${enrollment.courseId}`, {
			token: student,
		});
		expect(after.body.enrollment.rated).toBe(true);
		expect(after.body.rating).toEqual(expected);
		expect(after.body).not.toHaveProperty("reviews");
		expect(
			await prisma.course.findUniqueOrThrow({
				where: { id: enrollment.courseId },
				select: { ratingSum: true, ratingCount: true },
			}),
		).toEqual({
			ratingSum: totals.ratingSum + 2,
			ratingCount: totals.ratingCount + 1,
		});
	});
});
