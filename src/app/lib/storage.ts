// File storage behind one interface (BACKEND_SPEC section 15), so it can be
// swapped. Cloudinary in every real environment; an in-memory driver keeps
// tests from uploading anything (config refuses it in production).
//
// Public files (avatars, thumbnails) get a CDN url. Private files (application
// documents) are Cloudinary `authenticated` assets with no public url: they
// are read through short-lived signed download links.
import { randomUUID } from "node:crypto";
import type { UploadApiResponse } from "cloudinary";
import config from "../../config/index.js";
import cloudinary from "./cloudinary.js";

export interface StoredFile {
	publicId: string;
	// Public CDN url; null for private files
	url: string | null;
	format: string;
	private: boolean;
}

export interface Storage {
	name: "cloudinary" | "memory";
	put: (
		data: Buffer,
		options: { folder: string; private: boolean },
	) => Promise<StoredFile>;
	// A download link for a private file that stops working after `seconds`
	signedUrl: (file: StoredFile, seconds: number) => string;
	// A public copy of a private file (e.g. an approved teacher's photo as avatar)
	copyToPublic: (file: StoredFile, folder: string) => Promise<StoredFile>;
}

const folderPath = (folder: string) => `${config.cloudinary.folder}/${folder}`;

// ---------------------------------------------------------------- Cloudinary

// Images and PDFs are both Cloudinary "image" resources
const RESOURCE = "image" as const;

const fromResult = (r: UploadApiResponse, isPrivate: boolean): StoredFile => ({
	publicId: r.public_id,
	url: isPrivate ? null : r.secure_url,
	format: r.format,
	private: isPrivate,
});

const cloudinaryStorage: Storage = {
	name: "cloudinary",
	put: (data, options) =>
		new Promise((resolve, reject) => {
			const stream = cloudinary.uploader.upload_stream(
				{
					folder: folderPath(options.folder),
					public_id: randomUUID(),
					resource_type: RESOURCE,
					type: options.private ? "authenticated" : "upload",
					overwrite: false,
				},
				(err, result) =>
					err || !result
						? reject(err ?? new Error("Cloudinary returned no result"))
						: resolve(fromResult(result, options.private)),
			);
			stream.end(data);
		}),
	// API download link (works on every plan, unlike CDN token auth)
	signedUrl: (file, seconds) =>
		cloudinary.utils.private_download_url(file.publicId, file.format, {
			resource_type: RESOURCE,
			type: file.private ? "authenticated" : "upload",
			expires_at: Math.floor(Date.now() / 1000) + seconds,
		}),
	copyToPublic: async (file, folder) =>
		fromResult(
			await cloudinary.uploader.upload(cloudinaryStorage.signedUrl(file, 300), {
				folder: folderPath(folder),
				public_id: randomUUID(),
				resource_type: RESOURCE,
			}),
			false,
		),
};

// ---------------------------------------------------------------- memory (tests)

const memoryFiles = new Map<string, Buffer>();
const MEMORY_HOST = "https://storage.test";

const memoryStorage: Storage = {
	name: "memory",
	put: async (data, options) => {
		const publicId = `${folderPath(options.folder)}/${randomUUID()}`;
		memoryFiles.set(publicId, data);
		return {
			publicId,
			url: options.private ? null : `${MEMORY_HOST}/${publicId}`,
			format: "bin",
			private: options.private,
		};
	},
	signedUrl: (file, seconds) =>
		`${MEMORY_HOST}/signed/${file.publicId}?expires=${Math.floor(Date.now() / 1000) + seconds}`,
	copyToPublic: async (file, folder) =>
		memoryStorage.put(memoryFiles.get(file.publicId) ?? Buffer.alloc(0), {
			folder,
			private: false,
		}),
};

export const storage: Storage =
	config.storage_driver === "memory" ? memoryStorage : cloudinaryStorage;
