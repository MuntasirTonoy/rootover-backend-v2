import httpStatus from "http-status";
import type { z } from "zod";
import type { User } from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { AVATAR_PRESETS } from "../../utils/constants.js";
import { hashPassword, verifyPassword } from "../auth/auth.utils.js";
import { SessionService } from "../session/session.service.js";
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

// `sessionId` is the device making the change; it stays signed in after a
// password change
const updateMe = async (
	user: User,
	input: UpdateMeInput,
	sessionId: string | undefined,
) => {
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

	// Every other device is logged out (its LoginSession deleted, and tokenVersion
	// bumped); this one keeps its session with a fresh token
	const passwordHash = await hashPassword(password);
	const [updated] = await prisma.$transaction([
		prisma.user.update({
			where: { id: user.id },
			data: { ...profile, passwordHash, tokenVersion: { increment: 1 } },
		}),
		SessionService.endAll(prisma, user.id, sessionId),
	]);
	if (!sessionId) return { user: toUserResponse(updated) };
	return {
		user: toUserResponse(updated),
		token: await SessionService.reissueToken(updated, sessionId),
	};
};

export const UserService = { updateMe };
