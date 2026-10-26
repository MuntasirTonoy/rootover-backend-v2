import type { TeacherProfile, User } from "../../../generated/prisma/client.js";
import type { TeacherProfileResponse, UserResponse } from "./user.interface.js";

// Never exposes passwordHash, tokenVersion or updatedAt; nulls become omitted fields
export const toUserResponse = (user: User): UserResponse => ({
	id: user.id,
	name: user.name,
	email: user.email,
	role: user.role,
	status: user.status,
	avatar: user.avatar ?? undefined,
	phone: user.phone ?? undefined,
	institution: user.institution ?? undefined,
	gender: user.gender ?? undefined,
	dateOfBirth: user.dateOfBirth ?? undefined,
	createdAt: user.createdAt.toISOString(),
});

export const toTeacherProfileResponse = (
	teacher: TeacherProfile,
): TeacherProfileResponse => ({
	id: teacher.id,
	userId: teacher.userId,
	teacherCode: teacher.teacherCode,
	headline: teacher.headline,
	bio: teacher.bio,
	qualifications: teacher.qualifications,
	institution: teacher.institution,
	experienceYears: teacher.experienceYears,
	joinedAt: teacher.joinedAt.toISOString(),
});
