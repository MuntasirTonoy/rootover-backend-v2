// Uploads (spec sections 10.8 and 15) with the memory storage driver, and the
// rule that avatars, thumbnails and application documents must be the user's
// own uploads. Throwaway students are deleted afterwards (their uploads
// cascade); the course created as u-t1 is deleted too.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	api,
	FILE_BYTES,
	prisma,
	startApp,
	tokenFor,
	uploadFile,
} from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const tag = Date.now().toString(36);
const startedAt = new Date();
const testUsers: string[] = [];
const createdCourses: string[] = [];
const t1Uploads: string[] = [];

const newStudent = async (name: string) => {
	const u = await prisma.user.create({
		data: {
			name: `${name} ${tag}`,
			email: `${name.toLowerCase()}-${tag}@upload-db.test`,
			passwordHash: "!",
			emailVerifiedAt: new Date(),
		},
	});
	testUsers.push(u.id);
	return { id: u.id, token: await tokenFor(u.id) };
};

const up = (
	token: string | undefined,
	purpose: string,
	name: string,
	bytes: number[],
	extra = 0,
) => uploadFile(app.base, token, purpose, name, bytes, extra);

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-t1", "u-admin"]) tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.course.deleteMany({ where: { id: { in: createdCourses } } });
	await prisma.upload.deleteMany({ where: { id: { in: t1Uploads } } });
	await prisma.activityLog.deleteMany({
		where: { actorId: { in: [...testUsers, "u-t1"] }, at: { gte: startedAt } },
	});
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
	await app.close();
}, 60_000);

describe("POST /api/uploads", () => {
	it("stores public images and types files by their bytes", async () => {
		expect(
			(await up(undefined, "avatar", "a.jpg", FILE_BYTES.jpeg)).status,
		).toBe(401);
		const s = await newStudent("Uploader");

		const avatar = await up(s.token, "avatar", "../../me.jpg", FILE_BYTES.jpeg);
		expect(avatar.status).toBe(201);
		expect(avatar.body).toMatchObject({
			name: "me.jpg",
			type: "image/jpeg",
			size: FILE_BYTES.jpeg.length,
		});
		expect(avatar.body.url).toMatch(/^https:\/\/storage\.test\/.+\/avatars\//);

		// A GIF named .jpg, and a PDF as an avatar, are both refused
		const gif = await up(s.token, "avatar", "fake.jpg", FILE_BYTES.gif);
		expect(gif.status).toBe(400);
		expect(gif.body.error.fields.file).toBe(
			"Upload a JPEG, PNG or WebP image.",
		);
		expect(
			(await up(s.token, "avatar", "doc.pdf", FILE_BYTES.pdf)).status,
		).toBe(400);

		const big = await up(
			s.token,
			"avatar",
			"big.png",
			FILE_BYTES.png,
			5 * 1024 * 1024,
		);
		expect(big.status).toBe(400);
		expect(big.body.error.message).toBe("Files must be 5 MB or smaller.");

		const purpose = await up(s.token, "banner", "a.png", FILE_BYTES.png);
		expect(purpose.status).toBe(400);
		expect(
			(await up(s.token, "thumbnail", "t.png", FILE_BYTES.png)).status,
		).toBe(403);
	});

	it("keeps application documents private: only the uploader and admins get a link", async () => {
		const owner = await newStudent("DocOwner");
		const other = await newStudent("DocOther");
		const doc = await up(
			owner.token,
			"application-doc",
			"ssc.pdf",
			FILE_BYTES.pdf,
		);
		expect(doc.status).toBe(201);
		expect(doc.body.type).toBe("application/pdf");
		expect(doc.body.url).toMatch(
			new RegExp(`/api/uploads/private/${doc.body.id}$`),
		);

		const mine = await call(`/uploads/private/${doc.body.id}`, {
			token: owner.token,
		});
		expect(mine.status).toBe(200);
		expect(mine.body.url).toMatch(/^https:\/\/storage\.test\/signed\//);
		expect(mine.body).toMatchObject({
			name: "ssc.pdf",
			type: "application/pdf",
		});
		expect(
			(await call(`/uploads/private/${doc.body.id}`, { token: other.token }))
				.status,
		).toBe(404);
		expect(
			(
				await call(`/uploads/private/${doc.body.id}`, {
					token: tokens["u-admin"],
				})
			).status,
		).toBe(200);
		expect((await call(`/uploads/private/${doc.body.id}`)).status).toBe(401);

		// A public upload has no private link
		const avatar = await up(owner.token, "avatar", "a.png", FILE_BYTES.png);
		expect(
			(await call(`/uploads/private/${avatar.body.id}`, { token: owner.token }))
				.status,
		).toBe(404);
	});
});

describe("references must be your own uploads", () => {
	it("avatar: a preset, your own photo, or unchanged", async () => {
		const s = await newStudent("Avatar");
		const other = await newStudent("AvatarOther");
		const patch = (avatar: string) =>
			call("/me", { method: "PATCH", token: s.token, body: { avatar } });

		const config = await call("/config");
		const preset = config.body.avatarPresets[0];
		expect((await patch(preset)).body.user.avatar).toBe(preset);

		const random = await patch("https://example.com/me.png");
		expect(random.status).toBe(400);
		expect(random.body.error.fields.avatar).toBe(
			"Choose one of the avatars or upload a photo.",
		);

		const foreign = await up(other.token, "avatar", "o.png", FILE_BYTES.png);
		expect((await patch(foreign.body.url)).status).toBe(400);

		const own = await up(s.token, "avatar", "me.png", FILE_BYTES.png);
		expect((await patch(own.body.url)).body.user.avatar).toBe(own.body.url);
	});

	it("course thumbnail: the teacher's own upload", async () => {
		const own = await up(tokens["u-t1"], "thumbnail", "cover.webp", [
			...Buffer.from("RIFF"),
			0,
			0,
			0,
			0,
			...Buffer.from("WEBP"),
		]);
		expect(own.status).toBe(201);
		expect(own.body.type).toBe("image/webp");
		t1Uploads.push(own.body.id);
		const s = await newStudent("NotTeacher");
		const foreign = await up(s.token, "avatar", "x.png", FILE_BYTES.png);

		const body = (thumbnail: string) => ({
			level: "SSC",
			title: `Upload test ${tag}`,
			price: 500,
			thumbnail,
		});
		const bad = await call("/teacher/courses", {
			method: "POST",
			token: tokens["u-t1"],
			body: body(foreign.body.url),
		});
		expect(bad.status).toBe(400);
		expect(bad.body.error.fields.thumbnail).toBe("Upload the thumbnail again.");
		const good = await call("/teacher/courses", {
			method: "POST",
			token: tokens["u-t1"],
			body: body(own.body.url),
		});
		expect(good.status).toBe(201);
		createdCourses.push(good.body.id);
		expect(good.body.thumbnail).toBe(own.body.url);
	});

	it("application documents: the applicant's own uploads of the declared type", async () => {
		const s = await newStudent("Applicant");
		const other = await newStudent("Thief");
		const mine = async (name: string, bytes: number[]) =>
			(await up(s.token, "application-doc", name, bytes)).body;
		const docs = {
			photo: await mine("photo.jpg", FILE_BYTES.jpeg),
			sscCertificate: await mine("ssc.pdf", FILE_BYTES.pdf),
			hscCertificate: await mine("hsc.pdf", FILE_BYTES.pdf),
			fatherVoterId: await mine("voter.pdf", FILE_BYTES.pdf),
		};
		const base = {
			fullName: `Applicant ${tag}`,
			nid: "9990000123456",
			bkashNumber: "01700000999",
			tin: "000000123456",
			dateOfBirth: "1995-04-15",
			gender: "male",
		};
		const submit = (token: string, body: unknown) =>
			call("/teacher-applications", { method: "POST", token, body });

		// Someone else's upload ids are refused
		const stolen = await submit(other.token, { ...base, ...docs });
		expect(stolen.status).toBe(400);
		expect(stolen.body.error.message).toBe("Upload this file again.");
		// Claiming a PDF is an image is refused
		const lie = await submit(s.token, {
			...base,
			...docs,
			fatherVoterId: { ...docs.fatherVoterId, type: "image/png" },
		});
		expect(lie.status).toBe(400);
		expect(lie.body.error.fields.fatherVoterId).toBe("Upload this file again.");

		const ok = await submit(s.token, { ...base, ...docs });
		expect(ok.status).toBe(201);
		expect(ok.body.photo).toEqual({
			url: docs.photo.url,
			name: "photo.jpg",
			type: "image/jpeg",
			size: FILE_BYTES.jpeg.length,
		});
	});
});
