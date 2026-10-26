import type { RequestHandler } from "express";
import httpStatus from "http-status";

const notFound: RequestHandler = (req, res) => {
	res.status(httpStatus.NOT_FOUND).json({
		error: {
			code: "NOT_FOUND",
			message: `Route ${req.method} ${req.originalUrl} not found.`,
		},
	});
};

export default notFound;
