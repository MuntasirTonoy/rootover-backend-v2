import httpStatus from "http-status";
import type { z } from "zod";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { AVATAR_PRESETS } from "../../utils/constants.js";
import {
	hashPassword,
	signAccessToken,
	verifyPassword,
} from "../auth/auth.utils.js";
import { ownPublicUpload } from "../upload/upload.service.js";
import { toUserResponse } from "./user.utils.js";
import type { UserValidation } from "./user.validation.js";

type UpdateMeInput = z.infer<typeof UserValidation.updateMe>["body"];

const AVATAR_MESSAGE = "Choose one of the avatars or upload a photo.";

// A new avatar must be a preset or the user's own uploaded photo
const checkAvatar = async (user: User, avatar: string | null | undefined) => {
	if (!avatar || avatar === user.avatar || AVATAR_PRESETS.includes(avatar))
		return;
	if (!(await ownPublicUpload(user.id, "avatar", avatar)))
		throw new AppError(httpStatus.BAD_REQUEST, AVATAR_MESSAGE, {
			avatar: AVATAR_MESSAGE,
		});
};

const updateMe = async (user: User, input: UpdateMeInput) => {
	const { password, currentPassword, ...profile } = input;
	await checkAvatar(user, profile.avatar);

	if (!password) {
		const updated = await prisma.user.update({
			where: { id: user.id },
			data: profile,
		});
		return { user: toUserResponse(updated) };
	}

	if (!(await verifyPassword(currentPassword ?? "", user.passwordHash)))
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Your current password is incorrect.",
			{ currentPassword: "Your current password is incorrect." },
		);

	// Bumping tokenVersion signs out every other device; this one gets a fresh token
	const updated = await prisma.user.update({
		where: { id: user.id },
		data: {
			...profile,
			passwordHash: await hashPassword(password),
			tokenVersion: { increment: 1 },
		},
	});
	return { user: toUserResponse(updated), token: signAccessToken(updated) };
};

export const UserService = { updateMe };
