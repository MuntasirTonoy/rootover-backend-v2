// Uploads (BACKEND_SPEC sections 10.8 and 15). Files are typed by their bytes,
// stored under random names, and recorded per uploader, so avatars, course
// thumbnails and application documents can only reference the user's own files.
import httpStatus from "http-status";
import config from "../../../config/index.js";
import type {
	Upload,
	UploadPurpose,
	User,
} from "../../../generated/prisma/client.js";
import AppError from "../../errors/AppError.js";
import prisma from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_PURPOSES = [
	"avatar",
	"thumbnail",
	"application-doc",
] as const;
export type UploadPurposeInput = (typeof UPLOAD_PURPOSES)[number];

const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED: Record<UploadPurposeInput, string[]> = {
	avatar: IMAGES,
	thumbnail: IMAGES,
	"application-doc": [...IMAGES, "application/pdf"],
};
const TYPE_MESSAGE: Record<UploadPurposeInput, string> = {
	avatar: "Upload a JPEG, PNG or WebP image.",
	thumbnail: "Upload a JPEG, PNG or WebP image.",
	"application-doc": "Upload a JPEG, PNG or WebP image, or a PDF.",
};
const toPurpose = (p: UploadPurposeInput): UploadPurpose =>
	p === "application-doc" ? "application_doc" : p;

// Signed links to private files last this long
const PRIVATE_LINK_SECONDS = 10 * 60;

// The real type from the file's first bytes (never the name or the browser's claim)
export function detectMime(data: Buffer): string | null {
	const starts = (bytes: number[], offset = 0) =>
		bytes.every((b, i) => data[offset + i] === b);
	if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return "image/png";
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
		return "image/webp";
	if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
	return null;
}

// The original name for display: no path, no control characters, bounded
export const displayName = (name: string) =>
	[...(name.split(/[\\/]/).pop() ?? "")]
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			return code >= 0x20 && code !== 0x7f;
		})
		.join("")
		.trim()
		.slice(0, 200) || "file";

// Private files are read through the API, never straight from storage
export const privateUrl = (id: string) =>
	`${config.api_public_url}/api/uploads/private/${id}`;

export const toUploadResponse = (u: Upload) => ({
	id: u.id,
	url: u.private ? privateUrl(u.id) : (u.url ?? ""),
	name: u.name,
	type: u.mime,
	size: u.size,
});

// POST /api/uploads
const create = async (
	user: User,
	purpose: UploadPurposeInput,
	file: { buffer: Buffer; originalname: string; size: number } | undefined,
) => {
	if (!file)
		throw new AppError(httpStatus.BAD_REQUEST, "Choose a file to upload.", {
			file: "Choose a file to upload.",
		});
	const mime = detectMime(file.buffer);
	if (!mime || !ALLOWED[purpose].includes(mime))
		throw new AppError(httpStatus.BAD_REQUEST, TYPE_MESSAGE[purpose], {
			file: TYPE_MESSAGE[purpose],
		});
	if (purpose === "thumbnail" && user.role !== "teacher")
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only teachers can upload course thumbnails.",
		);

	const isPrivate = purpose === "application-doc";
	let stored: Awaited<ReturnType<typeof storage.put>>;
	try {
		stored = await storage.put(file.buffer, {
			folder: `${purpose}s`,
			private: isPrivate,
		});
	} catch (err) {
		console.error("[upload] storage failed:", err);
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"The file couldn't be stored. Please try again.",
		);
	}
	const upload = await prisma.upload.create({
		data: {
			userId: user.id,
			purpose: toPurpose(purpose),
			publicId: stored.publicId,
			private: isPrivate,
			url: stored.url,
			format: stored.format,
			mime,
			name: displayName(file.originalname),
			size: file.size,
		},
	});
	return toUploadResponse(upload);
};

// GET /api/uploads/private/:id: a short-lived download link, for the uploader
// and admins only (anyone else gets a 404)
const privateLink = async (user: User, id: string) => {
	const upload = await prisma.upload.findUnique({ where: { id } });
	if (!upload?.private || (upload.userId !== user.id && user.role !== "admin"))
		throw new AppError(httpStatus.NOT_FOUND, "File not found.");
	return {
		url: storage.signedUrl(upload, PRIVATE_LINK_SECONDS),
		name: upload.name,
		type: upload.mime,
		expiresAt: new Date(Date.now() + PRIVATE_LINK_SECONDS * 1000).toISOString(),
	};
};

// ------------------------------------------------------------ ownership checks

// The user's own public upload with this url (avatar / thumbnail), or null
export const ownPublicUpload = (
	userId: string,
	purpose: "avatar" | "thumbnail",
	url: string,
) =>
	prisma.upload.findFirst({ where: { userId, purpose, url, private: false } });

// The user's own application document by id, or null
export const ownApplicationDoc = (userId: string, id: string) =>
	prisma.upload.findFirst({
		where: { id, userId, purpose: "application_doc" },
	});

export const UploadService = { create, privateLink };
