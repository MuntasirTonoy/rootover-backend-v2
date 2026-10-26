import type {
	ApplicationStatus,
	Level,
} from "../../../generated/prisma/client.js";
import type { CourseSummary, Progress } from "../course/course.interface.js";
import type {
	EnrollmentResponse,
	PurchaseView,
} from "../purchase/purchase.utils.js";

// BACKEND_SPEC section 11
export interface EnrolledCourse {
	enrollment: EnrollmentResponse;
	course: CourseSummary;
	progress: Progress;
	resumeLessonId?: string;
	lastLesson?: { id: string; title: string; chapterTitle: string };
}

export interface SavedLessonView {
	id: string;
	savedAt: string;
	course: {
		id: string;
		title: string;
		level: Level;
		subject: string;
		thumbnail?: string;
	};
	teacher: { id: string; name: string };
	lesson: { id: string; title: string; durationMin: number };
	// index is 0-based (curriculum order)
	chapter: { id: string; title: string; index: number };
}

export interface StudentDashboard {
	stats: {
		enrolled: number;
		lessonsCompleted: number;
		lessonsTotal: number;
		overallPercent: number;
		saved: number;
	};
	continueLearning: EnrolledCourse[];
	recentlyWatched: EnrolledCourse[];
	saved: SavedLessonView[];
	recentPurchases: PurchaseView[];
	// Latest teacher application (status card); full details come from
	// /api/me/teacher-application
	application: {
		id: string;
		status: ApplicationStatus;
		submittedAt: string;
		updatedAt: string;
		reviewNote?: string;
	} | null;
}
