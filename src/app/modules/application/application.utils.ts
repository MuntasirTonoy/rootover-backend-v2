// Response shapes for teacher applications and registration fees (BACKEND_SPEC
// section 11), plus identity masking for non-admin views.
import type {
	ApplicationStatus,
	RegistrationFee,
	TeacherApplication,
} from "../../../generated/prisma/client.js";

export interface UploadedDoc {
	url?: string;
	name: string;
	type: string;
	size: number;
}

export interface ApplicationResponse {
	id: string;
	userId: string;
	fullName: string;
	nid: string;
	bkashNumber: string;
	tin: string;
	dateOfBirth: string;
	gender: string;
	photo?: UploadedDoc;
	sscCertificate?: UploadedDoc;
	hscCertificate?: UploadedDoc;
	fatherVoterId?: UploadedDoc;
	status: ApplicationStatus;
	submittedAt: string;
	updatedAt: string;
	reviewNote?: string;
	teacherId?: string;
}

export interface RegistrationFeeResponse {
	id: string;
	applicationId: string;
	userId: string;
	amount: number;
	method: "bKash";
	payerNumber: string;
	trxId: string;
	paidAt: string;
}

// Stored JSON -> response doc. Never exposes the storage publicId.
const toDoc = (value: unknown): UploadedDoc | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const d = value as Record<string, unknown>;
	if (typeof d.name !== "string") return undefined;
	return {
		url: typeof d.url === "string" ? d.url : undefined,
		name: d.name,
		type: typeof d.type === "string" ? d.type : "",
		size: typeof d.size === "number" ? d.size : 0,
	};
};

// First 3 + bullets + last 3 characters, e.g. 017•••••999 (spec section 11)
export const maskIdentity = (value: string) =>
	value.length <= 6
		? "•".repeat(value.length)
		: `${value.slice(0, 3)}${"•".repeat(value.length - 6)}${value.slice(-3)}`;

export const toApplicationResponse = (
	a: TeacherApplication,
	opts: { mask?: boolean } = {},
): ApplicationResponse => {
	const hide = opts.mask ? maskIdentity : (v: string) => v;
	return {
		id: a.id,
		userId: a.userId,
		fullName: a.fullName,
		nid: hide(a.nid),
		bkashNumber: hide(a.bkashNumber),
		tin: hide(a.tin),
		dateOfBirth: a.dateOfBirth,
		gender: a.gender,
		photo: toDoc(a.photo),
		sscCertificate: toDoc(a.sscCertificate),
		hscCertificate: toDoc(a.hscCertificate),
		fatherVoterId: toDoc(a.fatherVoterId),
		status: a.status,
		submittedAt: a.submittedAt.toISOString(),
		updatedAt: a.updatedAt.toISOString(),
		reviewNote: a.reviewNote ?? undefined,
		teacherId: a.teacherId ?? undefined,
	};
};

export const toRegistrationFeeResponse = (
	f: RegistrationFee,
): RegistrationFeeResponse => ({
	id: f.id,
	applicationId: f.applicationId,
	userId: f.userId,
	amount: f.amount,
	method: "bKash",
	payerNumber: f.payerNumber,
	trxId: f.trxId,
	paidAt: f.paidAt.toISOString(),
});
