import type { ZodError } from "zod";

// Request schemas wrap body/query/params; the frontend maps errors by the inner
// path (e.g. "chapters.1.lessons.2.videoUrl"), so the wrapper key is dropped.
const WRAPPER_KEYS = new Set(["body", "query", "params"]);

const handleZodError = (error: ZodError) => {
	const fields: Record<string, string> = {};
	for (const issue of error.issues) {
		const segments = issue.path.map(String);
		if (WRAPPER_KEYS.has(segments[0])) segments.shift();
		const key = segments.join(".") || "_";
		// Keep the first message per field, matching how the frontend shows one error at a time
		fields[key] ??= issue.message;
	}
	const first = Object.values(fields)[0];
	return { message: first ?? "Some fields are invalid.", fields };
};

export default handleZodError;
