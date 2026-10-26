// Sign-up with an emailed code (register -> verify-email). The mailer is
// mocked so the test can read the code from the email it would have sent.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mail } from "../../src/app/lib/mailer.js";
import { api, prisma, startApp } from "./helpers.js";

const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("../../src/app/lib/mailer.js", () => ({
	mailerMode: () => "console",
	sendMail: async (mail: Mail) => {
		sent.push(mail);
	},
}));

const email = `verify-${Date.now()}@example.com`;

let app: ReturnType<typeof startApp>;
let call: ReturnType<typeof api>;

beforeAll(() => {
	app = startApp();
	call = api(app.base);
});

afterAll(async () => {
	const user = await prisma.user.findUnique({ where: { email } });
	if (user) {
		await prisma.activityLog.deleteMany({ where: { actorId: user.id } });
		await prisma.emailOtp.deleteMany({ where: { userId: user.id } });
		await prisma.user.delete({ where: { id: user.id } });
	}
	await app.close();
});

describe("register + verify-email", () => {
	it("signs the user in once the emailed code is confirmed", async () => {
		const reg = await call("/auth/register", {
			method: "POST",
			body: { name: "Code Student", email, password: "secret123" },
		});
		expect(reg.status).toBe(201);
		expect(reg.body.token).toBeUndefined();
		const mail = sent.find((m) => m.to === email);
		const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
		expect(code).toBeDefined();

		const login = await call("/auth/login", {
			method: "POST",
			body: { email, password: "secret123" },
		});
		expect(login.status).toBe(403);
		expect(login.body.error.code).toBe("EMAIL_NOT_VERIFIED");

		const wrong = await call("/auth/verify-email", {
			method: "POST",
			body: { email, code: code === "000000" ? "111111" : "000000" },
		});
		expect(wrong.status).toBe(400);

		const verified = await call("/auth/verify-email", {
			method: "POST",
			body: { email, code },
		});
		expect(verified.status).toBe(200);
		expect(verified.body.token).toEqual(expect.any(String));
		// The seeded database already has verified accounts: not the first admin
		expect(verified.body.user.role).toBe("student");
		const row = await prisma.user.findUniqueOrThrow({ where: { email } });
		expect(row.emailVerifiedAt).not.toBeNull();
	});
});
