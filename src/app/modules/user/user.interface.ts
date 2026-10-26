import type { Role, UserStatus } from "../../../generated/prisma/client.js";

// Response shapes from BACKEND_SPEC section 11. Optional fields are omitted
// (not null) to match the frontend types.
export interface UserResponse {
	id: string;
	name: string;
	email: string;
	role: Role;
	status: UserStatus;
	avatar?: string;
	phone?: string;
	institution?: string;
	gender?: string;
	dateOfBirth?: string;
	createdAt: string;
}

export interface TeacherProfileResponse {
	id: string;
	userId: string;
	teacherCode: string;
	headline: string;
	bio: string;
	qualifications: string[];
	institution: string;
	experienceYears: number;
	joinedAt: string;
}
