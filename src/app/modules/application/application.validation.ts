import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PDF = "application/pdf";

export const APPLICATION_STATUSES = [
	"pending_review",
	"payment_required",
	"under_verification",
	"approved",
	"rejected",
] as const;

// An uploaded file as referenced in the application body (BACKEND_SPEC
// section 15): the response of POST /api/uploads (purpose application-doc).
// The service checks that `id` is the applicant's own upload and stores the
// upload's own name/type/size; the metadata here gives the form its messages.
const doc = (required: string, types: string[], typeMessage: string) =>
	z.object(
		{
			id: z.string({ error: required }).min(1, required).max(64),
			url: z.string().max(2048).optional(),
			name: z.string({ error: required }).trim().min(1, required).max(200),
			type: z
				.string({ error: required })
				.refine((t) => types.includes(t), typeMessage),
			size: z
				.number({ error: required })
				.int()
				.positive(required)
				.max(MAX_DOC_BYTES, "Files must be 5 MB or smaller."),
		},
		{ error: required },
	);

// Calendar check: the 18th birthday is today or earlier
const isAdult = (dob: string, now = new Date()) => {
	const [y, m, d] = dob.split("-").map(Number);
	const eighteenth = Date.UTC(y + 18, m - 1, d);
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	return eighteenth <= today;
};

// Messages match the frontend form (BACKEND_SPEC section 9)
const submit = z.object({
	body: z.object({
		fullName: z
			.string({ error: "Enter your full name as on your NID." })
			.trim()
			.min(3, "Enter your full name as on your NID.")
			.max(100, "Use at most 100 characters."),
		nid: z
			.string({ error: "NID must be 10, 13 or 17 digits." })
			.trim()
			.regex(/^(\d{10}|\d{13}|\d{17})$/, "NID must be 10, 13 or 17 digits."),
		bkashNumber: z
			.string({ error: "Enter an 11-digit bKash number starting with 01." })
			.trim()
			.regex(/^01\d{9}$/, "Enter an 11-digit bKash number starting with 01."),
		tin: z
			.string({ error: "TIN must be 12 digits." })
			.trim()
			.regex(/^\d{12}$/, "TIN must be 12 digits."),
		dateOfBirth: z.iso
			.date({ error: "Enter your date of birth." })
			.refine((d) => d >= "1900-01-01", "Enter your date of birth.")
			.refine((d) => isAdult(d), "You must be at least 18 years old."),
		gender: z.enum(["male", "female", "other"], {
			error: "Select your gender.",
		}),
		photo: doc(
			"Upload a profile photograph.",
			IMAGE_TYPES,
			"The photograph must be a JPEG, PNG or WebP image.",
		),
		sscCertificate: doc(
			"Upload your SSC certificate.",
			[PDF],
			"The SSC certificate must be a PDF.",
		),
		hscCertificate: doc(
			"Upload your HSC certificate.",
			[PDF],
			"The HSC certificate must be a PDF.",
		),
		fatherVoterId: doc(
			"Upload your father's voter ID.",
			[...IMAGE_TYPES, PDF],
			"The voter ID must be an image or a PDF.",
		),
	}),
});

const id = z.object({ params: z.object({ id: z.string().min(1).max(64) }) });

// The payer's wallet number is entered on bKash's own page, not sent here
const payFee = id;

const adminList = z.object({
	query: z.object({
		status: z
			.enum(APPLICATION_STATUSES, {
				error: `status must be one of ${APPLICATION_STATUSES.join(", ")}.`,
			})
			.or(z.literal("").transform(() => undefined))
			.optional(),
		q: z.string().trim().max(100).optional(),
		...paginationQuery(10),
	}),
});

const reject = id.extend({
	body: z.object({
		reason: z
			.string({ error: "Give a reason for the rejection." })
			.trim()
			.min(5, "Give a reason for the rejection.")
			.max(1000, "Use at most 1000 characters."),
	}),
});

export const ApplicationValidation = { submit, id, payFee, adminList, reject };
