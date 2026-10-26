import { describe, expect, it } from "vitest";
import {
	couponState,
	formatTaka,
	type SubmittableCourse,
	validateForSubmit,
} from "../../src/app/modules/teacher/teacher.utils.js";
import {
	courseBody,
	TeacherValidation,
} from "../../src/app/modules/teacher/teacher.validation.js";
import { toEmbedUrl } from "../../src/app/utils/youtube.js";

const EMBED = "https://www.youtube.com/embed/dQw4w9WgXcQ";

describe("toEmbedUrl (spec section 9)", () => {
	it("accepts every supported YouTube form", () => {
		for (const input of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ?t=42",
			"https://www.youtube.com/shorts/dQw4w9WgXcQ",
			"https://www.youtube.com/embed/dQw4w9WgXcQ",
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
			"https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be",
			"https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be",
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLx&index=2",
			"https://youtu.be/dQw4w9WgXcQ?si=abc123",
			"https://www.youtube.com/live/dQw4w9WgXcQ?si=abc123",
			'<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>',
			"  https://youtu.be/dQw4w9WgXcQ  ",
		])
			expect(toEmbedUrl(input)).toBe(EMBED);
	});

	it("rejects other sites and malformed ids", () => {
		expect(toEmbedUrl("https://vimeo.com/123456")).toBeNull();
		expect(toEmbedUrl("https://youtu.be/short")).toBeNull();
		expect(toEmbedUrl("")).toBeNull();
	});
});

const complete = (): SubmittableCourse => ({
	title: "SSC Physics complete",
	subject: "Physics",
	description: "Everything for the SSC physics exam, chapter by chapter.",
	outcomes: ["Solve motion problems"],
	price: 1500,
	discountPrice: 1200,
	chapters: [
		{
			title: "Motion",
			lessons: [{ title: "Speed", durationMin: 12, videoUrl: EMBED }],
		},
	],
});

describe("validateForSubmit (spec section 9)", () => {
	it("passes a complete course", () => {
		expect(validateForSubmit(complete())).toEqual({});
	});

	it("reports every missing piece with editor keys and spec messages", () => {
		const c = complete();
		c.title = "Phys";
		c.subject = " ";
		c.description = "Too short";
		c.outcomes = [""];
		c.price = 99;
		c.discountPrice = null;
		c.chapters = [
			{ title: "", lessons: [] },
			{
				title: "Waves",
				lessons: [
					{ title: "", durationMin: 0, videoUrl: "https://vimeo.com/1" },
				],
			},
		];
		expect(validateForSubmit(c)).toEqual({
			title: "Give the course a title of at least 5 characters.",
			subject: "Enter the subject, e.g. Physics.",
			description: "Describe the course in at least 20 characters.",
			outcomes: "Add at least one learning outcome.",
			price: "The price must be at least ৳100.",
			"chapters.0.title": "Chapter title is required.",
			"chapters.0.lessons": "Add at least one lesson to this chapter.",
			"chapters.1.lessons.0.title": "Lesson title is required.",
			"chapters.1.lessons.0.durationMin": "Enter a duration in minutes.",
			"chapters.1.lessons.0.videoUrl":
				"Enter a valid YouTube link or embed code.",
		});
	});

	it("requires a discount below the price and at least one chapter", () => {
		const c = complete();
		c.discountPrice = 1500;
		c.chapters = [];
		expect(validateForSubmit(c)).toEqual({
			discountPrice: "The discount price must be lower than the regular price.",
			chapters: "Add at least one chapter.",
		});
	});
});

describe("courseBody (draft save)", () => {
	it("only needs a level, a title and a price", () => {
		const parsed = courseBody.parse({
			level: "SSC",
			title: "  Draft course  ",
			price: 0,
		});
		expect(parsed).toMatchObject({
			title: "Draft course",
			subject: "",
			outcomes: [],
			chapters: [],
			thumbnail: null,
			discountPrice: null,
		});
	});

	it("drops empty outcomes, treats a 0 discount and empty links as unset", () => {
		const parsed = courseBody.parse({
			level: "HSC",
			title: "Draft course",
			price: 1000,
			discountPrice: 0,
			thumbnail: "",
			outcomes: [" one ", "", "  "],
			chapters: [{ lessons: [{ title: "L", durationMin: 5, noteLink: "" }] }],
		});
		expect(parsed.outcomes).toEqual(["one"]);
		expect(parsed.discountPrice).toBeNull();
		expect(parsed.thumbnail).toBeNull();
		expect(parsed.chapters[0].lessons[0]).toMatchObject({
			noteLink: null,
			videoUrl: "",
			isPreview: false,
		});
	});

	it("rejects a short title and non-https note links on any save", () => {
		const r = courseBody.safeParse({
			level: "SSC",
			title: "Abc",
			price: 100,
			chapters: [
				{
					lessons: [{ durationMin: 5, noteLink: "javascript:alert(1)" }],
				},
			],
		});
		expect(r.success).toBe(false);
		const messages = r.error?.issues.map((i) => [i.path.join("."), i.message]);
		expect(messages).toContainEqual([
			"title",
			"Give the course a title of at least 5 characters.",
		]);
		expect(messages).toContainEqual([
			"chapters.0.lessons.0.noteLink",
			"Enter a valid https link for the notes.",
		]);
	});
});

describe("coupon body (spec section 9)", () => {
	const body = (over: Record<string, unknown>) => ({
		body: {
			code: "physics20",
			type: "percent",
			value: 20,
			usageLimit: 10,
			expiresAt: "2026-12-31T23:59:59+06:00",
			...over,
		},
	});
	const parse = (over: Record<string, unknown> = {}) =>
		TeacherValidation.createCoupon.safeParse(body(over));
	const firstMessage = (over: Record<string, unknown>) =>
		parse(over).error?.issues[0].message;

	it("uppercases the code and defaults to an active all-courses coupon", () => {
		const r = parse();
		expect(r.data?.body).toMatchObject({
			code: "PHYSICS20",
			courseId: null,
			active: true,
		});
		expect(r.data?.body.expiresAt).toBeInstanceOf(Date);
	});

	it("uses the spec messages", () => {
		expect(firstMessage({ code: "ab" })).toBe("Use 4–15 letters or numbers.");
		expect(firstMessage({ code: "NO SPACE" })).toBe(
			"Use 4–15 letters or numbers.",
		);
		expect(firstMessage({ value: 0 })).toBe("Enter a discount greater than 0.");
		expect(firstMessage({ value: 91 })).toBe(
			"Percentage discounts are capped at 90%.",
		);
		expect(parse({ type: "fixed", value: 500 }).success).toBe(true);
		expect(firstMessage({ usageLimit: 0 })).toBe("Allow at least one use.");
	});
});

describe("withdrawal body (spec section 9)", () => {
	const firstMessage = (body: Record<string, unknown>) =>
		TeacherValidation.requestWithdrawal.safeParse({ body }).error?.issues[0]
			.message;

	it("uses the spec messages", () => {
		expect(firstMessage({ amount: 499, accountNumber: "01712345678" })).toBe(
			"The minimum withdrawal is ৳500.",
		);
		expect(firstMessage({ amount: 500, accountNumber: "1712345678" })).toBe(
			"Enter an 11-digit bKash number starting with 01.",
		);
		expect(
			firstMessage({ amount: 500, accountNumber: "01712345678" }),
		).toBeUndefined();
	});
});

describe("couponState / formatTaka", () => {
	const now = Date.UTC(2026, 9, 25);
	it("expiry wins over the active switch", () => {
		const past = new Date(now - 1);
		const future = new Date(now + 1);
		expect(couponState({ active: true, expiresAt: past }, now)).toBe("expired");
		expect(couponState({ active: false, expiresAt: past }, now)).toBe(
			"expired",
		);
		expect(couponState({ active: true, expiresAt: future }, now)).toBe(
			"active",
		);
		expect(couponState({ active: false, expiresAt: future }, now)).toBe(
			"inactive",
		);
	});

	it("formats activity-log amounts with thousands separators", () => {
		expect(formatTaka(12500)).toBe("৳12,500");
		expect(formatTaka(500)).toBe("৳500");
	});
});
