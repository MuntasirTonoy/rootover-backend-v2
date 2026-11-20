// Runs around every db test file: the devices that tokenFor() opened for
// seeded users are removed afterwards, so they never count against a demo
// student's device limit. Imports only the Prisma client: loading the app here
// would load it before a test file's vi.mock() calls apply.
import { afterAll } from "vitest";
import prisma from "../../src/app/lib/prisma.js";
import { TEST_USER_AGENT } from "./test-device.js";

afterAll(async () => {
	await prisma.loginSession.deleteMany({
		where: { userAgent: TEST_USER_AGENT },
	});
});
