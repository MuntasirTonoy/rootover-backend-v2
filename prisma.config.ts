import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
		// `prisma db seed` and `prisma migrate reset` run this
		seed: "tsx prisma/seed.ts",
	},
	datasource: {
		// The CLI (migrate, studio) prefers the direct connection: poolers such as
		// Neon's PgBouncer don't support the session features migrations rely on.
		// The app itself connects through DATABASE_URL (see src/app/lib/prisma.ts).
		url: process.env.DIRECT_URL || process.env.DATABASE_URL,
	},
});
