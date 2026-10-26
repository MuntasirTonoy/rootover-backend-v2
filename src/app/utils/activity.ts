import type { Prisma, User } from "../../generated/prisma/client.js";
import type prisma from "../lib/prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

// Writes one activity-log row (BACKEND_SPEC section 12). The actor's name and
// role are copied so history survives later changes. Pass the transaction
// client when the log belongs to a multi-row write.
export const logActivity = (
	db: Db,
	actor: Pick<User, "id" | "name" | "role"> | null,
	action: string,
	target: string,
) =>
	db.activityLog.create({
		data: {
			actorId: actor?.id ?? null,
			actorName: actor?.name ?? "System",
			actorRole: actor?.role ?? "system",
			action,
			target,
		},
	});
