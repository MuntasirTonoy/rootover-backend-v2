import config from "../../config/index.js";

export interface Mail {
	to: string;
	subject: string;
	text: string;
	html: string;
}

const RESEND_URL = "https://api.resend.com/emails";

// Resend when RESEND_API_KEY is set; otherwise (development/test only, enforced
// by config) emails are printed to the console so the codes can still be used.
export const mailerMode = () =>
	config.mail.resend_api_key ? "resend" : "console";

export const sendMail = async (mail: Mail) => {
	const key = config.mail.resend_api_key;
	if (!key) {
		if (config.env !== "test")
			console.log(
				`
[mail:console] To: ${mail.to}
Subject: ${mail.subject}
${mail.text}
`,
			);
		return;
	}
	const res = await fetch(RESEND_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: config.mail.from,
			to: [mail.to],
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { message?: string };
		throw new Error(
			`Resend rejected the email (${res.status}): ${body.message ?? res.statusText}`,
		);
	}
};
