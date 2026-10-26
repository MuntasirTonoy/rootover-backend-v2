// The Resend mailer against a mocked API
import { afterEach, describe, expect, it, vi } from "vitest";

const mail = {
	to: "a@b.test",
	subject: "Code",
	text: "123456",
	html: "<b>123456</b>",
};

const loadMailer = async (key: string | undefined) => {
	vi.resetModules();
	vi.stubEnv("RESEND_API_KEY", key ?? "");
	vi.stubEnv("EMAIL_FROM", "Root Over <no-reply@rootover.test>");
	return import("../../src/app/lib/mailer.js");
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("mailer", () => {
	it("posts the email to Resend", async () => {
		const fetchMock = vi.fn(async () => new Response('{"id":"e1"}'));
		vi.stubGlobal("fetch", fetchMock);
		const { mailerMode, sendMail } = await loadMailer("re_test");
		expect(mailerMode()).toBe("resend");
		await sendMail(mail);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init.headers).toMatchObject({ Authorization: "Bearer re_test" });
		expect(JSON.parse(String(init.body))).toEqual({
			from: "Root Over <no-reply@rootover.test>",
			to: ["a@b.test"],
			subject: "Code",
			text: "123456",
			html: "<b>123456</b>",
		});
	});

	it("throws Resend's message when it refuses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response('{"message":"Domain not verified"}', { status: 403 }),
			),
		);
		const { sendMail } = await loadMailer("re_test");
		await expect(sendMail(mail)).rejects.toThrow(
			"Resend rejected the email (403): Domain not verified",
		);
	});

	it("falls back to the console without a key", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { mailerMode, sendMail } = await loadMailer(undefined);
		expect(mailerMode()).toBe("console");
		await sendMail(mail);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
