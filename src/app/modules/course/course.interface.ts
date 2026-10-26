import type {
	CourseStatus,
	Level,
	UserStatus,
} from "../../../generated/prisma/client.js";
import type { TeacherProfileResponse } from "../user/user.interface.js";

// Response shapes from BACKEND_SPEC section 11

// A lesson as the requester may see it. Locked lessons never carry their
// video or notes link (BACKEND_SPEC section 7).
export interface LessonPublic {
	id: string;
	title: string;
	durationMin: number;
	videoUrl: string | null;
	noteLink: string | null;
	isPreview: boolean;
	canWatch: boolean;
}

export interface ChapterPublic {
	id: string;
	title: string;
	lessons: LessonPublic[];
}

export interface Rating {
	average: number;
	count: number;
}

export interface Progress {
	completed: number;
	total: number;
	percent: number;
}

export interface TeacherPublic extends TeacherProfileResponse {
	name: string;
	avatar?: string;
	status: UserStatus;
	// Derived from the teacher's catalog (published) courses only
	stats: {
		courses: number;
		students: number;
		rating: number;
		reviewCount: number;
	};
}

export interface CourseSummary {
	id: string;
	level: Level;
	subject: string;
	title: string;
	thumbnail?: string;
	price: number;
	discountPrice?: number;
	effectivePrice: number;
	discountPercent: number;
	teacher: { id: string; name: string; avatar?: string };
	rating: Rating;
	studentCount: number;
	lessonCount: number;
	chapterCount: number;
	durationMin: number;
	featured: boolean;
	createdAt: string;
}

export interface CourseAccess {
	enrolled: boolean;
	owner: boolean;
	full: boolean;
}

export interface CourseDetail extends Omit<CourseSummary, "teacher"> {
	description: string;
	outcomes: string[];
	status: CourseStatus;
	statusNote?: string;
	// In the catalog? false = the owner or an admin previewing it
	published: boolean;
	chapters: ChapterPublic[];
	teacher: TeacherPublic;
	access: CourseAccess;
	// completedLessonIds (not in the spec) drives the player's checkmarks
	enrollment?: {
		progress: Progress;
		resumeLessonId?: string;
		completedLessonIds: string[];
		// Each buyer may rate the course once (not in the spec)
		rated: boolean;
	};
}

export interface FreePreview {
	course: CourseSummary;
	lesson: LessonPublic;
	chapterTitle: string;
}

// The full course for its owner and admins (spec `Course`): every lesson keeps
// its video and notes link, so never send this shape to students or guests
export interface LessonResponse {
	id: string;
	title: string;
	durationMin: number;
	videoUrl: string;
	noteLink: string | null;
	isPreview: boolean;
}

export interface CourseResponse {
	id: string;
	teacherId: string;
	level: Level;
	subject: string;
	title: string;
	description: string;
	thumbnail?: string;
	outcomes: string[];
	price: number;
	discountPrice?: number;
	status: CourseStatus;
	statusNote?: string;
	chapters: { id: string; title: string; lessons: LessonResponse[] }[];
	rating: Rating;
	featured: boolean;
	createdAt: string;
	updatedAt: string;
}
