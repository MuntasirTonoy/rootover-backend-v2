import type { Role } from "../../../generated/prisma/client.js";

// Claims inside an access token. `role` is informational for the client only;
// the server always reloads the user and trusts the database, never the token.
export interface AccessTokenPayload {
	sub: string;
	role: Role;
	// User.tokenVersion at issue time; a mismatch means the token was revoked
	v: number;
}
