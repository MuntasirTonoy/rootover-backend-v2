import type { Server } from "http";
import app from "./app.js";
import { mailerMode } from "./app/lib/mailer.js";
import prisma from "./app/lib/prisma.js";
import config, { BKASH_URLS } from "./config/index.js";

let server: Server | undefined;

async function shutdown(code: number) {
	await prisma.$disconnect().catch(() => undefined);
	if (!server) process.exit(code);
	server.close(() => process.exit(code));
}

async function bootstrap() {
	try {
		// Fail at startup (not on the first request) when the database is unreachable
		await prisma.$connect();
		await prisma.$queryRaw`SELECT 1`;
		console.log("Database connected");

		console.log(
			mailerMode() === "resend"
				? "Email: sending through Resend"
				: "Email: no RESEND_API_KEY, emails are printed to this console",
		);

		if (config.payment.provider === "bkash" && !config.payment.bkash.known_url)
			console.warn(
				`Payments: BKASH_BASE_URL is not a known bKash URL (sandbox ${BKASH_URLS.sandbox}, live ${BKASH_URLS.live})`,
			);
		if (config.env === "production" && config.payment.bkash.sandbox)
			console.warn(
				"Payments: bKash SANDBOX in production; no real money will be collected",
			);
		console.log(
			`Payments: ${config.payment.provider === "bkash" ? (config.payment.bkash.sandbox ? "bKash sandbox" : "bKash live") : "simulated"}${config.demo_mode ? " · demo mode on" : ""}`,
		);

		server = app.listen(config.port, () => {
			console.log(`Server is running on port ${config.port}`);
		});
	} catch (err) {
		console.error("Failed to start server:", err);
		await prisma.$disconnect().catch(() => undefined);
		process.exit(1);
	}
}

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection, shutting down:", reason);
	shutdown(1);
});

process.on("uncaughtException", (err) => {
	console.error("Uncaught exception, shutting down:", err);
	process.exit(1);
});

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

bootstrap();
