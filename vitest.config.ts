import { defineConfig } from "vitest/config";

// Two projects:
// - unit (`npm test`): pure logic, no database or network
// - db (`npm run test:db`): runs against the database in .env; seed it first
//   with `npm run db:seed`
export default defineConfig({
	test: {
		environment: "node",
		testTimeout: 30_000,
		// Tests never reach real services, whatever .env holds: payments stay
		// simulated, uploads stay in memory and emails are printed, not sent.
		// (Set here, dotenv never overrides them.)
		env: {
			PAYMENT_PROVIDER: "simulated",
			STORAGE_DRIVER: "memory",
			RESEND_API_KEY: "",
			DEMO_MODE: "true",
		},
		projects: [
			{
				extends: true,
				test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
			},
			{
				extends: true,
				// The files share one database and some briefly change seeded rows
				// (bans, course statuses), so they run one after another
				test: {
					name: "db",
					include: ["tests/db/**/*.test.ts"],
					fileParallelism: false,
					// Long end-to-end flows make many Neon round trips
					testTimeout: 120_000,
					hookTimeout: 60_000,
				},
			},
		],
	},
});
