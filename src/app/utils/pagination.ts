import { z } from "zod";

export const MAX_LIMIT = 100;

// ?page=1&limit=10 (BACKEND_SPEC section 3). Spread into a query schema.
export const paginationQuery = (defaultLimit = 10) => ({
	page: z.coerce
		.number({ error: "page must be a number." })
		.int()
		.min(1, "page must be 1 or more.")
		.default(1),
	limit: z.coerce
		.number({ error: "limit must be a number." })
		.int()
		.min(1, "limit must be 1 or more.")
		.max(MAX_LIMIT, `limit can be at most ${MAX_LIMIT}.`)
		.default(defaultLimit),
});

export interface Pagination {
	page: number;
	limit: number;
	total: number;
	pages: number;
}

export interface Paginated<T> {
	data: T[];
	pagination: Pagination;
}

export const pageMeta = (
	page: number,
	limit: number,
	total: number,
): Pagination => ({ page, limit, total, pages: Math.ceil(total / limit) });

// For lists that are filtered or sorted on derived values in memory
export const paginateArray = <T>(
	items: T[],
	page: number,
	limit: number,
): Paginated<T> => ({
	data: items.slice((page - 1) * limit, page * limit),
	pagination: pageMeta(page, limit, items.length),
});

// For database queries: Prisma skip/take
export const skipTake = (page: number, limit: number) => ({
	skip: (page - 1) * limit,
	take: limit,
});
