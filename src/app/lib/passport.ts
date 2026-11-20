import passport from "passport";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import config from "../../config/index.js";
import type { AccessTokenPayload } from "../modules/auth/auth.interface.js";
import { AuthService } from "../modules/auth/auth.service.js";
import { JWT_AUDIENCE, JWT_ISSUER } from "../modules/auth/auth.utils.js";
import { SessionService } from "../modules/session/session.service.js";

// POST /api/auth/login. Wrong credentials and banned accounts are thrown as
// AppErrors by verifyCredentials and passed through as `err`.
passport.use(
	new LocalStrategy(
		{ usernameField: "email", passwordField: "password", session: false },
		(email, password, done) => {
			AuthService.verifyCredentials(email, password).then(
				(user) => done(null, user),
				(err) => done(err),
			);
		},
	),
);

// Every protected request: Authorization: Bearer <access token>.
// The user is reloaded from the database so role changes and bans apply at once.
// The token must still have its device (LoginSession `sid`: logging out or
// "log out this device" deletes it) and the current tokenVersion (bumped by a
// password change). The device id is passed on as `info.sid`.
passport.use(
	new JwtStrategy(
		{
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			secretOrKey: config.jwt.access_secret,
			algorithms: ["HS256"],
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
		},
		(payload: AccessTokenPayload, done) => {
			if (typeof payload.sid !== "string") return done(null, false);
			SessionService.findActive(payload.sid).then(
				(session) =>
					session &&
					session.userId === payload.sub &&
					session.user.tokenVersion === payload.v
						? done(null, session.user, { sid: session.id })
						: done(null, false),
				(err) => done(err),
			);
		},
	),
);

export default passport;
