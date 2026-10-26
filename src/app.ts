import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import helmet from "helmet";
import morgan from "morgan";
import passport from "./app/lib/passport.js";
import globalErrorHandler from "./app/middlewares/globalErrorHandler.js";
import notFound from "./app/middlewares/notFound.js";
import router from "./app/routes/index.js";
import config from "./config/index.js";

const app: Application = express();

// Behind a hosting proxy, req.ip (used by the rate limiters) must be the
// client's address from X-Forwarded-For, not the proxy's
if (config.trust_proxy) app.set("trust proxy", config.trust_proxy);

// Security headers + strict CORS (a wildcard origin can't be combined with credentials)
app.use(helmet());
app.use(cors({ origin: config.frontend_url, credentials: true }));

// Request logging
if (config.env !== "test")
	app.use(morgan(config.env === "production" ? "combined" : "dev"));

// Parsers
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Passport strategies (local for login, jwt for Bearer tokens); no sessions
app.use(passport.initialize());

app.get("/", (req: Request, res: Response) => {
	res.json({ name: "Root Over Education API", docs: "/api/health" });
});

app.use("/api", router);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
