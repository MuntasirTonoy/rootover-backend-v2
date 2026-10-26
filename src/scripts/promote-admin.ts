// Makes an existing account an admin. Production has no seed, and sign-up only
// creates students, so this is how the first admin is made:
//
//   1. register and verify the account in the app as usual
//   2. npm run build && npm run admin:promote -- someone@example.com
//      (in development: npx tsx src/scripts/promote-admin.ts someone@example.com)
//
// Only an active, verified student account can be promoted (a teacher has a
// teacher profile and courses that an admin account must not carry).
import prisma from "../app/lib/prisma.js";
import { normaliseEmail } from "../app/modules/auth/auth.utils.js";

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

async function main() {
	const email = normaliseEmail(process.argv[2] ?? "");
	if (!email.includes("@"))
		fail("Usage: npm run admin:promote -- someone@example.com");

	const user = await prisma.user.findUnique({ where: { email } });
	if (!user)
		return fail(`No account with the email ${email}. Register it first.`);
	if (user.role === "admin")
		return console.log(`${email} is already an admin.`);
	if (!user.emailVerifiedAt)
		fail(`${email} hasn't verified its email yet. Verify it first.`);
	if (user.status !== "active") fail(`${email} is banned.`);
	if (user.role !== "student")
		fail(`${email} is a ${user.role}; only student accounts can be promoted.`);

	await prisma.user.update({
		where: { id: user.id },
		// Signs out the account's existing sessions; it logs in again as an admin
		data: { role: "admin", tokenVersion: { increment: 1 } },
	});
	console.log(`${email} is now an admin. Log in again to use the admin area.`);
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
