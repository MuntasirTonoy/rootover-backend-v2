import { PrismaPg } from "@prisma/adapter-pg";
import config from "../../config/index.js";
import { Prisma, PrismaClient } from "../../generated/prisma/client.js";

// DATABASE_URL may name a Postgres schema with ?schema=<name> (Prisma's
// convention); the default is "public". node-postgres doesn't understand the
// parameter, so it is taken off the connection string and given to the adapter,
// which qualifies every ORM query with it.
const url = new URL(config.database_url);
export const dbSchema = url.searchParams.get("schema") || "public";
url.searchParams.delete("schema");

// Raw SQL must name the schema too: `${table("Course")}` -> "public"."Course"
export const table = (model: Prisma.ModelName) =>
	Prisma.raw(`"${dbSchema}"."${model}"`);

// Prisma 7 talks to Postgres through a driver adapter (node-postgres here)
const adapter = new PrismaPg(
	{ connectionString: url.toString() },
	{ schema: dbSchema },
);

// Query errors are not logged here: handled ones (e.g. a unique violation mapped
// to 409) would be noise, and unhandled ones are logged by globalErrorHandler.
const prisma = new PrismaClient({
	adapter,
	log: config.env === "test" ? [] : ["warn"],
});

export default prisma;
