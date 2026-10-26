// Teacher application workflow (BACKEND_SPEC section 8):
// pending_review -(admin: request fee)-> payment_required -(applicant pays ৳300
// through bKash)-> under_verification -(admin: approve)-> approved; any of the
// three open states -(admin: reject + reason)-> rejected.
import httpStatus from "http-status";
import type { z } from "zod";
import type {
	ApplicationStatus,
	Prisma,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import { isPrismaKnownError } from "../../errors/handlePrismaError.js";
import prisma from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { logActivity } from "../../utils/activity.js";
import { pageMeta, skipTake } from "../../utils/pagination.js";
import { PaymentService } from "../payment/payment.service.js";
import { ownApplicationDoc, privateUrl } from "../upload/upload.service.js";
import { toTeacherProfileResponse } from "../user/user.utils.js";
import {
	toApplicationResponse,
	toRegistrationFeeResponse,
} from "./application.utils.js";
import type { ApplicationValidation } from "./application.validation.js";

type SubmitInput = z.infer<typeof ApplicationValidation.submit>["body"];
type ListQuery = z.infer<typeof ApplicationValidation.adminList>["query"];

export const OPEN_STATUSES: ApplicationStatus[] = [
	"pending_review",
	"payment_required",
	"under_verification",
];

const NOT_FOUND = "Application not found.";
const BAD_TRANSITION =
	"This application can't be updated from its current status.";

const latestOf = (userId: string) =>
	prisma.teacherApplication.findFirst({
		where: { userId },
		orderBy: { submittedAt: "desc" },
		include: { registrationFee: true },
	});

// GET /api/me/teacher-application: the latest application (own data, unmasked)
const getMine = async (user: User) => {
	const [application, teacher] = await Promise.all([
		latestOf(user.id),
		prisma.teacherProfile.findUnique({ where: { userId: user.id } }),
	]);
	return {
		application: application ? toApplicationResponse(application) : null,
		registrationFee: application?.registrationFee
			? toRegistrationFeeResponse(application.registrationFee)
			: null,
		teacher: teacher ? toTeacherProfileResponse(teacher) : null,
	};
};

// Only students apply. One open application at a time; after a rejection a new
// application can be submitted (the old one stays as history).
const submit = async (user: User, input: SubmitInput) => {
	if (user.role !== "student")
		throw new AppError(
			httpStatus.FORBIDDEN,
			user.role === "teacher"
				? "You're already an approved teacher."
				: "Only students can apply to become a teacher.",
		);

	const docs = await resolveDocs(user, input);
	const created = await prisma.$transaction(async (tx) => {
		// Serialises submissions per user, so two at once can't both pass the check
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`application:${user.id}`}))`;
		const open = await tx.teacherApplication.count({
			where: { userId: user.id, status: { in: OPEN_STATUSES } },
		});
		if (open)
			throw new AppError(
				httpStatus.CONFLICT,
				"You already have an application in progress.",
			);
		const application = await tx.teacherApplication.create({
			data: { ...input, ...docs, userId: user.id },
		});
		await logActivity(
			tx,
			user,
			"Submitted a teacher application",
			application.fullName,
		);
		return application;
	});
	return toApplicationResponse(created);
};

const DOC_FIELDS = [
	"photo",
	"sscCertificate",
	"hscCertificate",
	"fatherVoterId",
] as const;

// Every document must be the applicant's own private upload. What's stored is
// taken from the upload record (never the client's claims), with the private
// url that only the applicant and admins can open.
const resolveDocs = async (user: User, input: SubmitInput) => {
	const entries = await Promise.all(
		DOC_FIELDS.map(async (field) => {
			const upload = await ownApplicationDoc(user.id, input[field].id);
			if (!upload || upload.mime !== input[field].type)
				throw new AppError(httpStatus.BAD_REQUEST, "Upload this file again.", {
					[field]: "Upload this file again.",
				});
			return [
				field,
				{
					uploadId: upload.id,
					url: privateUrl(upload.id),
					publicId: upload.publicId,
					name: upload.name,
					type: upload.mime,
					size: upload.size,
				},
			] as const;
		}),
	);
	return Object.fromEntries(entries) as unknown as Record<
		(typeof DOC_FIELDS)[number],
		Prisma.InputJsonObject
	>;
};

// Moves an application from one of `from` to `to`, atomically. 404 if it
// doesn't exist (or isn't visible to this caller), 422 if the status doesn't allow it.
const transition = async (
	tx: Prisma.TransactionClient,
	where: Prisma.TeacherApplicationWhereInput & { id: string },
	from: ApplicationStatus[],
	data: Prisma.TeacherApplicationUpdateManyMutationInput,
) => {
	const { count } = await tx.teacherApplication.updateMany({
		where: { ...where, status: { in: from } },
		data,
	});
	if (count === 0) {
		const exists = await tx.teacherApplication.count({ where });
		throw exists
			? new AppError(httpStatus.UNPROCESSABLE_ENTITY, BAD_TRANSITION)
			: new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	}
	return tx.teacherApplication.findUniqueOrThrow({ where: { id: where.id } });
};

// The applicant pays the ৳300 registration fee through bKash: this starts the
// payment ({ paymentId, redirectURL }); the fee is recorded and the application
// moves to under_verification when bKash confirms it (payment module).
const payFee = async (user: User, id: string) => {
	// Only the applicant's own application; anyone else gets a 404
	const application = await prisma.teacherApplication.findFirst({
		where: { id, userId: user.id },
		select: { status: true },
	});
	if (!application) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	if (application.status !== "payment_required")
		throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, BAD_TRANSITION);
	return PaymentService.startFeePayment(user, id);
};

// ------------------------------------------------------------ admin

const adminList = async (query: ListQuery) => {
	const where: Prisma.TeacherApplicationWhereInput = {
		...(query.status ? { status: query.status } : {}),
		...(query.q
			? {
					OR: [
						{ fullName: { contains: query.q, mode: "insensitive" } },
						{ user: { email: { contains: query.q, mode: "insensitive" } } },
					],
				}
			: {}),
	};
	const [rows, total] = await Promise.all([
		prisma.teacherApplication.findMany({
			where,
			include: {
				user: { select: { email: true } },
				registrationFee: { select: { id: true } },
			},
			orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
			...skipTake(query.page, query.limit),
		}),
		prisma.teacherApplication.count({ where }),
	]);
	return {
		data: rows.map((a) => ({
			...toApplicationResponse(a),
			email: a.user.email,
			feePaid: !!a.registrationFee,
		})),
		pagination: pageMeta(query.page, query.limit, total),
	};
};

// Admins see identity numbers unmasked
const adminDetail = async (id: string) => {
	const a = await prisma.teacherApplication.findUnique({
		where: { id },
		include: {
			user: { select: { email: true } },
			registrationFee: true,
			teacher: true,
		},
	});
	if (!a) throw new AppError(httpStatus.NOT_FOUND, NOT_FOUND);
	return {
		application: toApplicationResponse(a),
		email: a.user.email,
		registrationFee: a.registrationFee
			? toRegistrationFeeResponse(a.registrationFee)
			: null,
		teacher: a.teacher ? toTeacherProfileResponse(a.teacher) : null,
	};
};

const requestPayment = async (admin: User, id: string) => {
	const application = await prisma.$transaction(async (tx) => {
		const updated = await transition(tx, { id }, ["pending_review"], {
			status: "payment_required",
		});
		await logActivity(
			tx,
			admin,
			"Requested registration fee",
			updated.fullName,
		);
		return updated;
	});
	return toApplicationResponse(application);
};

const reject = async (admin: User, id: string, reason: string) => {
	const application = await prisma.$transaction(async (tx) => {
		const updated = await transition(tx, { id }, OPEN_STATUSES, {
			status: "rejected",
			reviewNote: reason,
		});
		await logActivity(
			tx,
			admin,
			"Rejected teacher application",
			updated.fullName,
		);
		return updated;
	});
	return toApplicationResponse(application);
};

// A new teacher without an avatar gets a public copy of their application
// photo. Best-effort: approval never fails because of it.
const photoAsAvatar = async (userId: string, photo: unknown) => {
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

// Creates the teacher profile, links it, and turns the student into a teacher,
// all in one transaction. Retried if two approvals pick the same Teacher ID.
const approve = async (admin: User, id: string) => {
	for (let attempt = 1; ; attempt++) {
		try {
			const result = await prisma.$transaction(async (tx) => {
				const application = await transition(
					tx,
					{ id },
					["under_verification"],
					{ status: "approved" },
				);
				const applicant = await tx.user.findUniqueOrThrow({
					where: { id: application.userId },
				});
				const teacher = await tx.teacherProfile.create({
					data: {
						userId: applicant.id,
						teacherCode: await nextTeacherCode(tx),
					},
				});
				const updated = await tx.teacherApplication.update({
					where: { id },
					data: { teacherId: teacher.id },
				});
				if (applicant.role === "student")
					await tx.user.update({
						where: { id: applicant.id },
						data: { role: "teacher" },
					});
				await logActivity(
					tx,
					admin,
					"Approved teacher application",
					application.fullName,
				);
				return { application: updated, teacher };
			});
			await photoAsAvatar(result.application.userId, result.application.photo);
			return {
				application: toApplicationResponse(result.application),
				teacher: toTeacherProfileResponse(result.teacher),
			};
		} catch (err) {
			const codeClash =
				isPrismaKnownError(err) &&
				err.code === "P2002" &&
				JSON.stringify(err.meta ?? {}).includes("teacherCode");
			if (!codeClash || attempt >= 3) throw err;
		}
	}
};

export const ApplicationService = {
	getMine,
	submit,
	payFee,
	adminList,
	adminDetail,
	requestPayment,
	reject,
	approve,
};
