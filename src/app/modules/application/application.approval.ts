// Turning an applicant into a teacher, shared by the admin's "approve" and the
// automatic approval when the registration fee is paid (payment module). Kept
// apart from application.service so the payment module can use it without an
// import cycle (application.service imports the payment module).
import type {
	Prisma,
	TeacherApplication,
} from "../../../generated/prisma/client.js";
import { isPrismaKnownError } from "../../errors/handlePrismaError.js";
import prisma from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";

const CODE_PREFIX = "RO-T-26-";

// RO-T-26-<4 digits>, serial = 101 + existing profiles (spec section 8), moved
// past any code already taken
const nextTeacherCode = async (tx: Prisma.TransactionClient) => {
	const [count, codes] = await Promise.all([
		tx.teacherProfile.count(),
		tx.teacherProfile.findMany({
			where: { teacherCode: { startsWith: CODE_PREFIX } },
			select: { teacherCode: true },
		}),
	]);
	const highest = Math.max(
		100,
		...codes.map((c) => Number(c.teacherCode.slice(CODE_PREFIX.length)) || 0),
	);
	const serial = Math.max(101 + count, highest + 1);
	return `${CODE_PREFIX}${String(serial).padStart(4, "0")}`;
};

// For an application already moved to "approved" in this transaction: creates
// the teacher profile, links it and switches the student's role
export const createTeacher = async (
	tx: Prisma.TransactionClient,
	application: TeacherApplication,
) => {
	const applicant = await tx.user.findUniqueOrThrow({
		where: { id: application.userId },
	});
	const teacher = await tx.teacherProfile.create({
		data: { userId: applicant.id, teacherCode: await nextTeacherCode(tx) },
	});
	const updated = await tx.teacherApplication.update({
		where: { id: application.id },
		data: { teacherId: teacher.id },
	});
	if (applicant.role === "student")
		await tx.user.update({
			where: { id: applicant.id },
			data: { role: "teacher" },
		});
	return { application: updated, teacher };
};

// Two approvals at once can pick the same Teacher ID; the loser retries
export const isTeacherCodeClash = (err: unknown) =>
	isPrismaKnownError(err) &&
	err.code === "P2002" &&
	JSON.stringify(err.meta ?? {}).includes("teacherCode");

// A new teacher without an avatar gets a public copy of their application
// photo. Best-effort, after the transaction: approval never fails because of it.
export const photoAsAvatar = async (userId: string, photo: unknown) => {
	const uploadId = (photo as { uploadId?: unknown } | null)?.uploadId;
	if (typeof uploadId !== "string") return;
	try {
		const [user, upload] = await Promise.all([
			prisma.user.findUniqueOrThrow({ where: { id: userId } }),
			prisma.upload.findUnique({ where: { id: uploadId } }),
		]);
		if (user.avatar || !upload) return;
		const copy = await storage.copyToPublic(upload, "avatars");
		await prisma.$transaction([
			prisma.upload.create({
				data: {
					userId,
					purpose: "avatar",
					publicId: copy.publicId,
					private: false,
					url: copy.url,
					format: copy.format,
					mime: upload.mime,
					name: upload.name,
					size: upload.size,
				},
			}),
			prisma.user.update({ where: { id: userId }, data: { avatar: copy.url } }),
		]);
	} catch (err) {
		console.error(
			`[application] couldn't copy ${userId}'s photo as avatar`,
			err,
		);
	}
};
