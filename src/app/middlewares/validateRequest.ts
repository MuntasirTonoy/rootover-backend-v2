import type { RequestHandler } from "express";
import type { ZodType } from "zod";

// Validates { body?, query?, params? } against one zod schema and replaces each
// part with the parsed (coerced, defaulted, stripped) value.
const validateRequest =
	(schema: ZodType): RequestHandler =>
	async (req, res, next) => {
		const parsed = (await schema.parseAsync({
			body: req.body,
			query: req.query,
			params: req.params,
		})) as { body?: unknown; query?: unknown; params?: unknown };

		if (parsed.body !== undefined) req.body = parsed.body;
		// Express 5 exposes req.query as a getter, so it has to be redefined
		if (parsed.query !== undefined)
			Object.defineProperty(req, "query", {
				value: parsed.query,
				writable: true,
			});
		if (parsed.params !== undefined)
			req.params = parsed.params as typeof req.params;
		next();
	};

export default validateRequest;
