import type { User as DbUser } from "../../generated/prisma/client.js";

declare global {
	namespace Express {
		// Passport types req.user as Express.User; make that our database user.
		// It has to be an interface (not a type alias) so it merges with Passport's.
		interface User extends DbUser {}
	}
}
