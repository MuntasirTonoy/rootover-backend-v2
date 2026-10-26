// Course ratings: PUT /api/learn/:courseId/review (students who bought the
// course, 1-5 stars, one review each, sending again updates it) and myReview
// on the course details. The seeded student's original review is restored.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, prisma, startApp, tokenFor } from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
let student: string;
let teacher: string;
let ownedCourseId: string;
let otherCourseId: string;
let original: Awaited<ReturnType<typeof prisma.review.findUnique>>;
const startedAt = new Date();

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	student = await tokenFor("u-s1");
	teacher = await tokenFor("u-t1");
	const owned = await prisma.enrollment.findFirstOrThrow({
		where: { studentId: "u-s1", course: { status: "approved" } },
		select: { courseId: true },
	});
	ownedCourseId = owned.courseId;
	const other = await prisma.course.findFirstOrThrow({
		where: {
			status: "approved",
			enrollments: { none: { studentId: "u-s1" } },
		},
		select: { id: true },
	});
	otherCourseId = other.id;
	original = await prisma.review.findUnique({
		where: {
			courseId_studentId: { courseId: ownedCourseId, studentId: "u-s1" },
		},
	});
});

afterAll(async () => {
	await prisma.review.deleteMany({
		where: { courseId: ownedCourseId, studentId: "u-s1" },
	});
	if (original) await prisma.review.create({ data: original });
	await prisma.activityLog.deleteMany({
		where: {
			actorId: "u-s1",
			action: { startsWith: "Rated a course" },
			at: { gte: startedAt },
		},
	});
	await app.close();
});

describe("course reviews", () => {
	it("rejects ratings outside 1-5", async () => {
		const r = await call(`/learn/${ownedCourseId}/review`, {
			method: "PUT",
			token: student,
			body: { rating: 6 },
		});
		expect(r.status).toBe(400);
		expect(r.body.error.fields.rating).toBe(
			"Choose a rating from 1 to 5 stars.",
		);
	});

	it("only lets students who bought the course rate it", async () => {
		const notOwned = await call(`/learn/${otherCourseId}/review`, {
			method: "PUT",
			token: student,
			body: { rating: 4 },
		});
		expect(notOwned.status).toBe(403);
		const asTeacher = await call(`/learn/${ownedCourseId}/review`, {
			method: "PUT",
			token: teacher,
			body: { rating: 4 },
		});
		expect(asTeacher.status).toBe(403);
	});

	it("creates, then updates, the student's single review", async () => {
		const first = await call(`/learn/${ownedCourseId}/review`, {
			method: "PUT",
			token: student,
			body: { rating: 3, comment: "  Good start  " },
		});
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ rating: 3, comment: "Good start" });

		const second = await call(`/learn/${ownedCourseId}/review`, {
			method: "PUT",
			token: student,
			body: { rating: 5 },
		});
		expect(second.status).toBe(200);
		expect(second.body).toMatchObject({ rating: 5, comment: "" });
		expect(
			await prisma.review.count({
				where: { courseId: ownedCourseId, studentId: "u-s1" },
			}),
		).toBe(1);

		const detail = await call(`/courses/${ownedCourseId}`, { token: student });
		expect(detail.body.myReview).toMatchObject({ rating: 5 });
		expect(
			detail.body.reviews.some((r: { id: string }) => r.id === second.body.id),
		).toBe(true);
		const guest = await call(`/courses/${ownedCourseId}`);
		expect(guest.body.myReview).toBeUndefined();
	});
});
