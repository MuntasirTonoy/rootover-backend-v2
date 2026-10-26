// Shared helpers for tests that run the real app against the seeded database
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../../src/app.js";
import prisma from "../../src/app/lib/prisma.js";
import { signAccessToken } from "../../src/app/modules/auth/auth.utils.js";

export { prisma };

export const startApp = () => {
	const server: Server = app.listen(0);
	const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
	return { base, close: () => new Promise((r) => server.close(r)) };
};

// A real access token for a seeded user, without spending the login rate limit
export const tokenFor = async (userId: string) =>
	signAccessToken(
		await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
	);

export const api =
	(base: string) =>
	async (
		path: string,
		init: { method?: string; token?: string; body?: unknown } = {},
	) => {
		const r = await fetch(base + path, {
			method: init.method ?? "GET",
			headers: {
				"Content-Type": "application/json",
				...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const text = await r.text();
		// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected loosely
		return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
	};

// Follows a payment's redirectURL the way the payer's browser would. With the
// simulated provider (forced for tests in vitest.config.ts) that URL is our own
// callback; it is pointed at this test server instead of API_PUBLIC_URL.
// Returns where the callback sent the browser (the frontend's result page).
export const followPayment = async (base: string, redirectURL: string) => {
	const url = new URL(redirectURL);
	const target = new URL(url.pathname + url.search, new URL(base).origin);
	const r = await fetch(target, { redirect: "manual" });
	return { status: r.status, location: r.headers.get("location") ?? "" };
};

// The first bytes of each file type, which is all the upload checks look at
export const FILE_BYTES = {
	jpeg: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46],
	png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
	pdf: [...Buffer.from("%PDF-1.4\n%demo\n")],
	gif: [...Buffer.from("GIF89a")],
};

// POST /api/uploads as multipart (stored by the memory driver in tests)
export const uploadFile = async (
	base: string,
	token: string | undefined,
	purpose: string,
	name: string,
	bytes: number[],
	extraBytes = 0,
) => {
	const form = new FormData();
	form.set("purpose", purpose);
	const data = new Uint8Array([...bytes, ...new Array(extraBytes).fill(0)]);
	form.set("file", new Blob([data]), name);
	const r = await fetch(`${base}/uploads`, {
		method: "POST",
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		body: form,
	});
	// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected loosely
	return { status: r.status, body: (await r.json()) as any };
};
