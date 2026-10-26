// Upload helpers: file typing by content and display names
import { describe, expect, it } from "vitest";
import {
	detectMime,
	displayName,
} from "../../src/app/modules/upload/upload.service.js";

const bytes = (...b: number[]) => Buffer.from(b);

describe("detectMime", () => {
	it("recognises the allowed types by their first bytes", () => {
		expect(detectMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
		expect(
			detectMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
		).toBe("image/png");
		expect(
			detectMime(Buffer.concat([Buffer.from("RIFF"), bytes(1, 2, 3, 4), Buffer.from("WEBP")])),
		).toBe("image/webp");
		expect(detectMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
	});

	it("refuses everything else, whatever it's called", () => {
		expect(detectMime(Buffer.from("GIF89a"))).toBeNull();
		expect(detectMime(Buffer.from("<svg xmlns=..."))).toBeNull();
		expect(detectMime(Buffer.from("RIFF1234WAVE"))).toBeNull();
		expect(detectMime(Buffer.alloc(0))).toBeNull();
	});
});

describe("displayName", () => {
	it("drops paths and control characters", () => {
		expect(displayName("../../etc/pass\u0007wd.pdf")).toBe("passwd.pdf");
		expect(displayName(String.raw`C:\Users\me\photo.jpg`)).toBe("photo.jpg");
		expect(displayName("  \u0000  ")).toBe("file");
		expect(displayName("a".repeat(300))).toHaveLength(200);
	});
});
