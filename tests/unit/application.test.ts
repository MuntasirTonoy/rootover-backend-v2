import { describe, expect, it } from "vitest";
import { maskIdentity } from "../../src/app/modules/application/application.utils.js";

describe("maskIdentity", () => {
	it("keeps the first and last 3 characters (spec example 017•••••999)", () => {
		expect(maskIdentity("01712345999")).toBe("017•••••999");
		expect(maskIdentity("1234567890")).toBe("123••••890");
		expect(maskIdentity("000000123456")).toBe("000••••••456");
		expect(maskIdentity("12345")).toBe("•••••");
	});
});
