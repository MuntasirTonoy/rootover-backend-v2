import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "../../../generated/prisma/client.js";
import config from "../../../config/index.js";
import type { AccessTokenPayload } from "./auth.interface.js";

// Shared by signing (here) and verification (lib/passport.ts)
export const JWT_ISSUER = "rootover-api";
export const JWT_AUDIENCE = "rootover-web";

export const hashPassword = (password: string) =>
	bcrypt.hash(password, config.bcrypt_salt_rounds);

export const verifyPassword = (password: string, hash: string) =>
	bcrypt.compare(password, hash);

// Compared against when the email is unknown, so a failed login takes about as
// long whether or not the account exists (no user enumeration by timing)
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
	"rootover-timing-equaliser",
	config.bcrypt_salt_rounds,
);

export const signAccessToken = (user: User) => {
	const payload: AccessTokenPayload = {
		sub: user.id,
		role: user.role,
		v: user.tokenVersion,
	};
	return jwt.sign(payload, config.jwt.access_secret, {
		algorithm: "HS256",
		expiresIn: config.jwt.access_expires_in as SignOptions["expiresIn"],
		issuer: JWT_ISSUER,
		audience: JWT_AUDIENCE,
	});
};

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
