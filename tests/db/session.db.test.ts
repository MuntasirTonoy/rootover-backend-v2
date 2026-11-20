// Signed-in devices (modules/session): every token belongs to a LoginSession,
// students are limited to MAX_STUDENT_DEVICES and pick a device to log out
// when they are over it, and devices can be listed and logged out.
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../src/config/index.js";
import {
	hashPassword,
	JWT_AUDIENCE,
	JWT_ISSUER,
} from "../../src/app/modules/auth/auth.utils.js";
import { MAX_STUDENT_DEVICES } from "../../src/app/modules/session/session.service.js";
import { describeDevice } from "../../src/app/modules/session/session.utils.js";
import { prisma, startApp } from "./helpers.js";

const UA = {
	windowsChrome:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
	iphoneSafari:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	androidChrome:
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
	macFirefox:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0",
};

let app: ReturnType<typeof startApp>;
const tag = Date.now().toString(36);
const password = "Device@1234";
const testUsers: string[] = [];

// Like helpers.api, plus the browser's User-Agent
const call = async (
	path: string,
	init: { method?: string; token?: string; body?: unknown; ua?: string } = {},
) => {
	const r = await fetch(app.base + path, {
		method: init.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": init.ua ?? UA.windowsChrome,
			...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const text = await r.text();
	// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected loosely
	return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};

const makeUser = async (role: "student" | "teacher") => {
	const user = await prisma.user.create({
		data: {
			name: `Device ${role} ${tag}`,
			email: `device-${role}-${tag}@session-db.test`,
			passwordHash: await hashPassword(password),
			emailVerifiedAt: new Date(),
			role,
		},
	});
	testUsers.push(user.id);
	return user;
};

const login = (email: string, ua: string, replaceSessionId?: string) =>
	call("/auth/login", {
		method: "POST",
		ua,
		body: { email, password, replaceSessionId },
	});

const works = async (token: string) =>
	(await call("/auth/me", { token })).status;

beforeAll(() => {
	app = startApp();
});

afterAll(async () => {
	await prisma.activityLog.deleteMany({
		where: { actorId: { in: testUsers } },
	});
	await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
	await app.close();
});

describe("describeDevice", () => {
	it("names common browsers, systems and device types", () => {
		expect(describeDevice(UA.windowsChrome)).toEqual({
			browser: "Chrome",
			os: "Windows",
			deviceType: "desktop",
		});
		expect(describeDevice(UA.iphoneSafari)).toEqual({
			browser: "Safari",
			os: "iOS",
			deviceType: "mobile",
		});
		expect(describeDevice(UA.androidChrome).os).toBe("Android");
		expect(describeDevice(UA.macFirefox)).toMatchObject({
			browser: "Firefox",
			os: "macOS",
		});
		expect(describeDevice("")).toEqual({
			browser: "Unknown browser",
			os: "Unknown system",
			deviceType: "desktop",
		});
	});
});

describe("student device limit", () => {
	it(`allows ${MAX_STUDENT_DEVICES} devices, then asks which one to log out`, async () => {
		const student = await makeUser("student");
		const a = await login(student.email, UA.windowsChrome);
		const b = await login(student.email, UA.iphoneSafari);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);

		const list = await call("/me/sessions", { token: b.body.token });
		expect(list.status).toBe(200);
		expect(list.body.limit).toBe(MAX_STUDENT_DEVICES);
		expect(list.body.devices).toHaveLength(2);
		// This device first
		expect(list.body.devices[0]).toMatchObject({
			browser: "Safari",
			os: "iOS",
			deviceType: "mobile",
			current: true,
		});
		const deviceA = list.body.devices[1];
		expect(deviceA).toMatchObject({ browser: "Chrome", current: false });

		// A third device is refused with the list to choose from, and no token
		const third = await login(student.email, UA.androidChrome);
		expect(third.status).toBe(409);
		expect(third.body.error.code).toBe("DEVICE_LIMIT");
		expect(third.body.error.limit).toBe(MAX_STUDENT_DEVICES);
		expect(third.body.error.devices).toHaveLength(2);
		expect(third.body.token).toBeUndefined();

		// An id that isn't one of theirs doesn't help
		const wrong = await login(student.email, UA.androidChrome, "not-a-device");
		expect(wrong.status).toBe(409);

		// Choosing device A logs A out and lets the new one in
		const c = await login(student.email, UA.androidChrome, deviceA.id);
		expect(c.status).toBe(200);
		expect(await works(a.body.token)).toBe(401);
		expect(await works(b.body.token)).toBe(200);
		expect(await works(c.body.token)).toBe(200);
		expect(
			await prisma.loginSession.count({ where: { userId: student.id } }),
		).toBe(2);

		// Logging out ends that device only
		const out = await call("/auth/logout", {
			method: "POST",
			token: c.body.token,
		});
		expect(out.status).toBe(204);
		expect(await works(c.body.token)).toBe(401);
		expect(await works(b.body.token)).toBe(200);
	});

	it("doesn't limit teachers", async () => {
		const teacher = await makeUser("teacher");
		for (const ua of [UA.windowsChrome, UA.iphoneSafari, UA.androidChrome])
			expect((await login(teacher.email, ua)).status).toBe(200);
		const list = await call("/me/sessions", {
			token: (await login(teacher.email, UA.macFirefox)).body.token,
		});
		expect(list.body.limit).toBeNull();
		expect(list.body.devices).toHaveLength(4);
	});
});

describe("managing devices", () => {
	it("logs out one device, all others, or every device", async () => {
		const teacher = await prisma.user.findFirstOrThrow({
			where: { email: `device-teacher-${tag}@session-db.test` },
		});
		await prisma.loginSession.deleteMany({ where: { userId: teacher.id } });
		const a = (await login(teacher.email, UA.windowsChrome)).body.token;
		const b = (await login(teacher.email, UA.iphoneSafari)).body.token;
		const c = (await login(teacher.email, UA.androidChrome)).body.token;

		// One device, chosen from the list
		const list = await call("/me/sessions", { token: a });
		const deviceB = list.body.devices.find(
			(d: { os: string }) => d.os === "iOS",
		);
		const del = await call(`/me/sessions/${deviceB.id}`, {
			method: "DELETE",
			token: a,
		});
		expect(del.status).toBe(204);
		expect(await works(b)).toBe(401);
		const again = await call(`/me/sessions/${deviceB.id}`, {
			method: "DELETE",
			token: a,
		});
		expect(again.status).toBe(404);

		// Every other device
		const others = await call("/me/sessions?others=true", {
			method: "DELETE",
			token: a,
		});
		expect(others.status).toBe(200);
		expect(others.body.loggedOut).toBe(1);
		expect(await works(c)).toBe(401);
		expect(await works(a)).toBe(200);

		// Every device, this one included
		const d = (await login(teacher.email, UA.macFirefox)).body.token;
		const all = await call("/me/sessions", { method: "DELETE", token: a });
		expect(all.body.loggedOut).toBe(2);
		expect(await works(a)).toBe(401);
		expect(await works(d)).toBe(401);
	});

	it("can't touch another user's devices", async () => {
		const student = await prisma.user.findFirstOrThrow({
			where: { email: `device-student-${tag}@session-db.test` },
		});
		const theirs = await prisma.loginSession.findFirstOrThrow({
			where: { userId: student.id },
		});
		const teacher = await prisma.user.findFirstOrThrow({
			where: { email: `device-teacher-${tag}@session-db.test` },
		});
		const token = (await login(teacher.email, UA.windowsChrome)).body.token;
		const del = await call(`/me/sessions/${theirs.id}`, {
			method: "DELETE",
			token,
		});
		expect(del.status).toBe(404);
		expect(await prisma.loginSession.count({ where: { id: theirs.id } })).toBe(
			1,
		);
	});

	it("a password change logs out the other devices and keeps this one", async () => {
		const student = await prisma.user.findFirstOrThrow({
			where: { email: `device-student-${tag}@session-db.test` },
		});
		await prisma.loginSession.deleteMany({ where: { userId: student.id } });
		const a = (await login(student.email, UA.windowsChrome)).body.token;
		const b = (await login(student.email, UA.iphoneSafari)).body.token;

		const changed = await call("/me", {
			method: "PATCH",
			token: a,
			body: { password, currentPassword: password },
		});
		expect(changed.status).toBe(200);
		expect(await works(b)).toBe(401);
		// The old token of this device has the old tokenVersion; the new one works
		expect(await works(a)).toBe(401);
		expect(await works(changed.body.token)).toBe(200);
		const list = await call("/me/sessions", { token: changed.body.token });
		expect(list.body.devices).toHaveLength(1);
		expect(list.body.devices[0].current).toBe(true);
	});

	it("rejects tokens without a device (issued before this feature)", async () => {
		const student = await prisma.user.findFirstOrThrow({
			where: { email: `device-student-${tag}@session-db.test` },
		});
		const legacy = jwt.sign(
			{ sub: student.id, role: student.role, v: student.tokenVersion },
			config.jwt.access_secret,
			{
				algorithm: "HS256",
				expiresIn: "1h",
				issuer: JWT_ISSUER,
				audience: JWT_AUDIENCE,
			},
		);
		expect(await works(legacy)).toBe(401);
	});
});
