// Teacher application workflow end to end (spec section 8, spec test 10).
// Applicants are throwaway students; their profiles are removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	api,
	FILE_BYTES,
	followPayment,
	prisma,
	startApp,
	tokenFor,
	uploadFile,
} from "./helpers.js";

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tokens: Record<string, string> = {};
const DOMAIN = "@application-db.test";
const tag = Date.now().toString(36);
const testUsers: string[] = [];
const testNames: string[] = [];

const newStudent = async (name: string) => {
	const fullName = `${name} ${tag}`;
	const u = await prisma.user.create({
		data: {
			name: fullName,
			email: `${name.toLowerCase()}-${tag}${DOMAIN}`,
			passwordHash: "!",
			emailVerifiedAt: new Date(),
		},
	});
	testUsers.push(u.id);
	testNames.push(fullName);
	return { id: u.id, name: fullName, token: await tokenFor(u.id) };
};

// Metadata only: enough for requests rejected before the uploads are checked
const doc = (name: string, type: string, size = 120_000) => ({
	id: "not-an-upload",
	name,
	type,
	size,
});

// The four documents, really uploaded by this student
const uploadDocs = async (token: string) => {
	const up = async (name: string, bytes: number[]) =>
		(await uploadFile(app.base, token, "application-doc", name, bytes)).body;
	return {
		photo: await up("photo.jpg", FILE_BYTES.jpeg),
		sscCertificate: await up("ssc.pdf", FILE_BYTES.pdf),
		hscCertificate: await up("hsc.pdf", FILE_BYTES.pdf),
		fatherVoterId: await up("voter.png", FILE_BYTES.png),
	};
};
const form = (fullName: string, overrides: Record<string, unknown> = {}) => ({
	fullName,
	nid: "9990000123456",
	bkashNumber: "01700000999",
	tin: "000000123456",
	dateOfBirth: "1995-04-15",
	gender: "female",
	photo: doc("photo.jpg", "image/jpeg"),
	sscCertificate: doc("ssc.pdf", "application/pdf"),
	hscCertificate: doc("hsc.pdf", "application/pdf"),
	fatherVoterId: doc("voter.png", "image/png"),
	...overrides,
});

beforeAll(async () => {
	app = startApp();
	call = api(app.base);
	for (const id of ["u-s1", "u-t1", "u-admin"]) tokens[id] = await tokenFor(id);
});

afterAll(async () => {
	await prisma.activityLog.deleteMany({
		where: {
			OR: [{ actorId: { in: testUsers } }, { target: { in: testNames } }],
		},
	});
	await prisma.payment.deleteMany({ where: { userId: { in: testUsers } } });
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } }); // cascades applications, fees, profiles
	await app.close();
	await prisma.$disconnect();
});

describe("submitting an application", () => {
	it("validates every field with the frontend's messages", async () => {
		const s = await newStudent("Invalid");
		const today = new Date();
		const tooYoung = `${today.getUTCFullYear() - 17}-01-01`;
		const r = await call("/teacher-applications", {
			method: "POST",
			token: s.token,
			body: form("Al", {
				nid: "12345",
				tin: "12",
				bkashNumber: "0170",
				dateOfBirth: tooYoung,
				gender: "",
				photo: doc("photo.gif", "image/gif"),
				sscCertificate: undefined,
				hscCertificate: doc("hsc.pdf", "application/pdf", 6 * 1024 * 1024),
			}),
		});
		expect(r.status).toBe(400);
		expect(r.body.error.fields).toEqual({
			fullName: "Enter your full name as on your NID.",
			nid: "NID must be 10, 13 or 17 digits.",
			bkashNumber: "Enter an 11-digit bKash number starting with 01.",
			tin: "TIN must be 12 digits.",
			dateOfBirth: "You must be at least 18 years old.",
			gender: "Select your gender.",
			"photo.type": "The photograph must be a JPEG, PNG or WebP image.",
			sscCertificate: "Upload your SSC certificate.",
			"hscCertificate.size": "Files must be 5 MB or smaller.",
		});
	});

	it("only students can apply; one open application at a time", async () => {
		const teacher = await call("/teacher-applications", {
			method: "POST",
			token: tokens["u-t1"],
			body: form("Dr. Rezaul Karim"),
		});
		expect(teacher.status).toBe(403);
		expect(teacher.body.error.message).toBe(
			"You're already an approved teacher.",
		);
		expect(
			(
				await call("/teacher-applications", {
					method: "POST",
					token: tokens["u-admin"],
					body: form("Platform Admin"),
				})
			).status,
		).toBe(403);

		const s = await newStudent("Twice");
		// Two submissions at once: the per-user lock lets exactly one through
		const docs = await uploadDocs(s.token);
		const both = await Promise.all(
			[0, 1].map(() =>
				call("/teacher-applications", {
					method: "POST",
					token: s.token,
					body: form(s.name, docs),
				}),
			),
		);
		expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
		expect(both.find((r) => r.status === 409)?.body.error.message).toBe(
			"You already have an application in progress.",
		);
		expect(
			await prisma.teacherApplication.count({ where: { userId: s.id } }),
		).toBe(1);
	});
});

describe("the full workflow (spec test 10)", () => {
	it("submit -> request fee -> pay -> approve turns the student into a teacher", async () => {
		const s = await newStudent("Applicant");
		const submitted = await call("/teacher-applications", {
			method: "POST",
			token: s.token,
			body: form(s.name, { ...(await uploadDocs(s.token)), pin: "1234" }),
		});
		expect(submitted.status).toBe(201);
		const id = submitted.body.id;
		expect(submitted.body).toMatchObject({
			userId: s.id,
			status: "pending_review",
			nid: "9990000123456",
			photo: { name: "photo.jpg", type: "image/jpeg" },
		});
		expect(submitted.body.photo).not.toHaveProperty("publicId");

		let mine = await call("/me/teacher-application", { token: s.token });
		expect(mine.body).toMatchObject({
			application: { id, status: "pending_review" },
			registrationFee: null,
			teacher: null,
		});

		// Paying before the fee is requested is an illegal transition
		let r = await call(`/teacher-applications/${id}/pay-fee`, {
			method: "POST",
			token: s.token,
		});
		expect(r.status).toBe(422);
		expect(r.body.error.message).toBe(
			"This application can't be updated from its current status.",
		);
		expect(
			(
				await call(`/admin/teacher-applications/${id}/approve`, {
					method: "POST",
					token: tokens["u-admin"],
				})
			).status,
		).toBe(422);

		r = await call(`/admin/teacher-applications/${id}/request-payment`, {
			method: "POST",
			token: tokens["u-admin"],
		});
		expect(r.body.status).toBe("payment_required");
		expect(
			(
				await call(`/admin/teacher-applications/${id}/request-payment`, {
					method: "POST",
					token: tokens["u-admin"],
				})
			).status,
		).toBe(422);

		// Someone else can't pay it
		const other = await newStudent("Other");
		expect(
			(
				await call(`/teacher-applications/${id}/pay-fee`, {
					method: "POST",
					token: other.token,
				})
			).status,
		).toBe(404);

		// Paying starts a bKash payment; the fee is recorded once it's confirmed
		r = await call(`/teacher-applications/${id}/pay-fee`, {
			method: "POST",
			token: s.token,
		});
		expect(r.status).toBe(200);
		expect(r.body.redirectURL).toBeTruthy();
		expect(
			(await prisma.teacherApplication.findUniqueOrThrow({ where: { id } }))
				.status,
		).toBe("payment_required");
		await followPayment(app.base, r.body.redirectURL);
		const payment = (
			await call(`/payments/${r.body.paymentId}`, { token: s.token })
		).body;
		expect(payment).toMatchObject({
			purpose: "registration_fee",
			state: "completed",
			amount: 300,
			applicationId: id,
		});
		expect(payment.registrationFee).toMatchObject({
			applicationId: id,
			userId: s.id,
			amount: 300,
			method: "bKash",
			payerNumber: "01000000000",
		});
		expect(payment.registrationFee.trxId).toMatch(/^DEMO[A-Z0-9]+$/);
		mine = await call("/me/teacher-application", { token: s.token });
		expect(mine.body.application.status).toBe("under_verification");
		expect(
			await prisma.activityLog.count({
				where: {
					actorId: s.id,
					action: "Paid the teacher registration fee (simulated payment)",
				},
			}),
		).toBe(1);
		expect(
			(
				await call(`/teacher-applications/${id}/pay-fee`, {
					method: "POST",
					token: s.token,
				})
			).status,
		).toBe(422);

		const teachersBefore = await prisma.teacherProfile.count();
		// Two approvals at once: only one succeeds
		const approvals = await Promise.all(
			[0, 1].map(() =>
				call(`/admin/teacher-applications/${id}/approve`, {
					method: "POST",
					token: tokens["u-admin"],
				}),
			),
		);
		expect(approvals.map((a) => a.status).sort()).toEqual([200, 422]);
		const approved = approvals.find((a) => a.status === 200)?.body;
		expect(approved.application).toMatchObject({
			status: "approved",
			teacherId: approved.teacher.id,
		});
		expect(approved.teacher.teacherCode).toBe(
			`RO-T-26-${String(101 + teachersBefore).padStart(4, "0")}`,
		);
		expect(approved.teacher).toMatchObject({
			userId: s.id,
			headline: "New teacher on Root Over",
			experienceYears: 0,
		});

		const user = await prisma.user.findUniqueOrThrow({ where: { id: s.id } });
		expect(user.role).toBe("teacher");
		// A public copy of the (private) application photo
		expect(user.avatar).toMatch(/^https:\/\/storage\.test\/.+\/avatars\//);
		expect(await prisma.teacherProfile.count()).toBe(teachersBefore + 1);

		// The same token now carries a teacher (roles are reloaded per request)
		mine = await call("/me/teacher-application", { token: s.token });
		expect(mine.body).toMatchObject({
			application: { status: "approved" },
			registrationFee: { amount: 300 },
			teacher: { teacherCode: approved.teacher.teacherCode },
		});
		expect((await call("/auth/me", { token: s.token })).body.user.role).toBe(
			"teacher",
		);
		// Approved is final
		expect(
			(
				await call(`/admin/teacher-applications/${id}/reject`, {
					method: "POST",
					token: tokens["u-admin"],
					body: { reason: "Too late now" },
				})
			).status,
		).toBe(422);

		const actions = (
			await prisma.activityLog.findMany({
				where: {
					target: { in: [s.name, "৳300 via bKash"] },
					at: { gte: user.createdAt },
				},
				orderBy: { at: "asc" },
			})
		).map((l) => l.action);
		expect(actions).toEqual(
			expect.arrayContaining([
				"Submitted a teacher application",
				"Requested registration fee",
				"Paid the teacher registration fee (simulated payment)",
				"Approved teacher application",
			]),
		);
	});

	it("reject needs a reason; a rejected applicant may apply again", async () => {
		const s = await newStudent("Rejected");
		const first = await call("/teacher-applications", {
			method: "POST",
			token: s.token,
			body: form(s.name, await uploadDocs(s.token)),
		});
		const noReason = await call(
			`/admin/teacher-applications/${first.body.id}/reject`,
			{ method: "POST", token: tokens["u-admin"], body: { reason: " " } },
		);
		expect(noReason.body.error.fields.reason).toBe(
			"Give a reason for the rejection.",
		);
		const rejected = await call(
			`/admin/teacher-applications/${first.body.id}/reject`,
			{
				method: "POST",
				token: tokens["u-admin"],
				body: { reason: "Certificates are unreadable." },
			},
		);
		expect(rejected.body).toMatchObject({
			status: "rejected",
			reviewNote: "Certificates are unreadable.",
		});

		const second = await call("/teacher-applications", {
			method: "POST",
			token: s.token,
			body: form(s.name, await uploadDocs(s.token)),
		});
		expect(second.status).toBe(201);
		const mine = await call("/me/teacher-application", { token: s.token });
		expect(mine.body.application.id).toBe(second.body.id); // latest wins, old kept as history
		expect(
			await prisma.teacherApplication.count({ where: { userId: s.id } }),
		).toBe(2);
	});
});

describe("admin views", () => {
	it("are admin-only", async () => {
		expect(
			(await call("/admin/teacher-applications", { token: tokens["u-s1"] }))
				.status,
		).toBe(403);
		expect(
			(
				await call("/admin/teacher-applications/app-s2/approve", {
					method: "POST",
					token: tokens["u-t1"],
				})
			).status,
		).toBe(403);
	});

	it("list newest first with email and fee status, filterable by status and search", async () => {
		const all = await call("/admin/teacher-applications?limit=100", {
			token: tokens["u-admin"],
		});
		const dates = all.body.data.map(
			(a: { submittedAt: string }) => a.submittedAt,
		);
		expect(dates).toEqual([...dates].sort().reverse());
		const seeded = all.body.data.find((a: { id: string }) => a.id === "app-s4");
		expect(seeded).toMatchObject({
			status: "under_verification",
			email: "sadia.akter@rootover.demo",
			feePaid: true,
		});
		expect(
			all.body.data.find((a: { id: string }) => a.id === "app-s3").feePaid,
		).toBe(false);
		const pending = await call(
			"/admin/teacher-applications?status=payment_required",
			{ token: tokens["u-admin"] },
		);
		expect(
			pending.body.data.every(
				(a: { status: string }) => a.status === "payment_required",
			),
		).toBe(true);
		const search = await call("/admin/teacher-applications?q=nusrat", {
			token: tokens["u-admin"],
		});
		expect(search.body.data.map((a: { id: string }) => a.id)).toEqual([
			"app-s2",
		]);
		const paged = await call("/admin/teacher-applications?limit=3&page=1", {
			token: tokens["u-admin"],
		});
		expect(paged.body.pagination.limit).toBe(3);
		expect(paged.body.data).toHaveLength(3);
	});

	it("detail shows unmasked identity numbers, fee and teacher", async () => {
		const { body } = await call("/admin/teacher-applications/app-t1", {
			token: tokens["u-admin"],
		});
		expect(body.application).toMatchObject({
			id: "app-t1",
			nid: "999000000101",
			status: "approved",
		});
		expect(body).toMatchObject({
			email: "teacher@rootover.demo",
			registrationFee: { amount: 300 },
			teacher: { teacherCode: "RO-T-26-0101" },
		});
		expect(
			(
				await call("/admin/teacher-applications/nope", {
					token: tokens["u-admin"],
				})
			).status,
		).toBe(404);
	});
});
