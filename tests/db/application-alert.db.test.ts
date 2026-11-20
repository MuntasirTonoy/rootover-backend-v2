// A submitted teacher application emails every active admin (user's request,
// 2026-11-20). The mailer is mocked, so nothing is really sent. Creates its own
// admin and student, so it doesn't need the demo seed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mail } from "../../src/app/lib/mailer.js";
import {
	api,
	FILE_BYTES,
	prisma,
	startApp,
	tokenFor,
	uploadFile,
} from "./helpers.js";

const sent = vi.hoisted(() => [] as Mail[]);
const failFor = vi.hoisted(() => new Set<string>());
vi.mock("../../src/app/lib/mailer.js", () => ({
	mailerMode: () => "console",
	sendMail: async (mail: Mail) => {
		if (failFor.has(mail.to)) throw new Error("mail outage");
		sent.push(mail);
	},
}));

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;
const tag = Date.now().toString(36);
const users: string[] = [];
const NID = "9990000654321";

const makeUser = async (kind: string, role: "admin" | "student") => {
	const user = await prisma.user.create({
		data: {
			name: `Alert ${kind} ${tag}`,
			email: `alert-${kind}-${tag}@alert-db.test`,
			passwordHash: "x",
			emailVerifiedAt: new Date(),
			role,
		},
	});
	users.push(user.id);
	return user;
};

beforeAll(() => {
	app = startApp();
	call = api(app.base);
});

afterAll(async () => {
	await prisma.activityLog.deleteMany({ where: { actorId: { in: users } } });
	await prisma.user.deleteMany({ where: { id: { in: users } } });
	await app.close();
});

describe("new teacher application", () => {
	it("emails every active admin, one email each, without identity numbers", async () => {
		const admin = await makeUser("admin", "admin");
		const otherAdmin = await makeUser("admin2", "admin");
		// This admin's mail fails: the others still get theirs and the submission succeeds
		failFor.add(otherAdmin.email);
		const student = await makeUser("student", "student");
		const token = await tokenFor(student.id);

		const up = async (name: string, bytes: number[]) =>
			(await uploadFile(app.base, token, "application-doc", name, bytes)).body;
		const res = await call("/teacher-applications", {
			method: "POST",
			token,
			body: {
				fullName: `Alert Applicant ${tag}`,
				nid: NID,
				bkashNumber: "01700000888",
				tin: "000000654321",
				dateOfBirth: "1996-02-10",
				gender: "male",
				photo: await up("photo.jpg", FILE_BYTES.jpeg),
				sscCertificate: await up("ssc.pdf", FILE_BYTES.pdf),
				hscCertificate: await up("hsc.pdf", FILE_BYTES.pdf),
				fatherVoterId: await up("voter.png", FILE_BYTES.png),
			},
		});
		expect(res.status).toBe(201);

		const activeAdmins = await prisma.user.findMany({
			where: {
				role: "admin",
				status: "active",
				emailVerifiedAt: { not: null },
			},
			select: { email: true },
		});
		const alerts = sent.filter((m) =>
			m.subject.includes("New teacher application"),
		);
		const recipients = alerts.map((m) => m.to);
		// One email per admin (minus the one whose mail failed), nobody else
		expect(recipients).toContain(admin.email);
		expect(recipients).not.toContain(otherAdmin.email);
		expect(recipients).not.toContain(student.email);
		expect(new Set(recipients).size).toBe(recipients.length);
		expect(recipients.length).toBe(activeAdmins.length - 1);

		const mail = alerts.find((m) => m.to === admin.email) as Mail;
		expect(mail.subject).toBe(
			`New teacher application: Alert Applicant ${tag}`,
		);
		expect(mail.text).toContain(student.email);
		expect(mail.text).toContain("/admin/teacher-applications");
		expect(`${mail.text}${mail.html}`).not.toContain(NID);
	});
});
