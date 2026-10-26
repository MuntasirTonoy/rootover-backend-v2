import type { Prisma } from "../../../generated/prisma/client.js";

// A course is in the catalog (listed, viewable, purchasable) only when it is
// approved AND its teacher's account is active (BACKEND_SPEC section 7).
// Banning a teacher hides all of their courses at once.
export const catalogWhere = {
	status: "approved",
	teacher: { user: { status: "active" } },
} satisfies Prisma.CourseWhereInput;

// Everything a CourseSummary is computed from
export const courseSummaryInclude = {
	teacher: {
		select: { id: true, user: { select: { name: true, avatar: true } } },
	},
	chapters: { select: { lessons: { select: { durationMin: true } } } },
	_count: { select: { enrollments: true } },
} satisfies Prisma.CourseInclude;

export type CourseSummaryRow = Prisma.CourseGetPayload<{
	include: typeof courseSummaryInclude;
}>;

const ordered = { orderBy: { position: "asc" } } as const;

// The full curriculum (ordered) plus what the summary needs
export const courseDetailInclude = {
	...courseSummaryInclude,
	chapters: {
		...ordered,
		include: { lessons: ordered },
	},
} satisfies Prisma.CourseInclude;

export type CourseDetailRow = Prisma.CourseGetPayload<{
	include: typeof courseDetailInclude;
}>;

// A teacher with the data behind TeacherPublic.stats (catalog courses only)
export const teacherPublicInclude = {
	user: { select: { name: true, avatar: true, status: true } },
	courses: {
		where: catalogWhere,
		select: {
			subject: true,
			ratingSum: true,
			ratingCount: true,
			enrollments: { select: { studentId: true } },
		},
	},
} satisfies Prisma.TeacherProfileInclude;

export type TeacherPublicRow = Prisma.TeacherProfileGetPayload<{
	include: typeof teacherPublicInclude;
}>;

// The full course as its owner or an admin edits it (raw lesson links)
export const courseFullInclude = {
	chapters: {
		...ordered,
		include: { lessons: ordered },
	},
} satisfies Prisma.CourseInclude;

export type CourseFullRow = Prisma.CourseGetPayload<{
	include: typeof courseFullInclude;
}>;
