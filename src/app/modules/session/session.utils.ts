import type { LoginSession } from "../../../generated/prisma/client.js";

export type DeviceType = "desktop" | "mobile" | "tablet";

export interface DeviceInfo {
	browser: string;
	os: string;
	deviceType: DeviceType;
}

const first = (ua: string, rules: [RegExp, string][], fallback: string) =>
	rules.find(([pattern]) => pattern.test(ua))?.[1] ?? fallback;

// Order matters: Edge, Opera and Samsung also say "Chrome", Chrome also says "Safari"
const BROWSERS: [RegExp, string][] = [
	[/Edg(e|A|iOS)?\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/SamsungBrowser\//, "Samsung Internet"],
	[/UCBrowser\//, "UC Browser"],
	[/Firefox\/|FxiOS\//, "Firefox"],
	[/Chrome\/|CriOS\//, "Chrome"],
	[/Safari\//, "Safari"],
];

// Android before Linux, iOS before macOS (iPhones say "like Mac OS X")
const SYSTEMS: [RegExp, string][] = [
	[/Windows/, "Windows"],
	[/Android/, "Android"],
	[/iPhone|iPad|iPod/, "iOS"],
	[/CrOS/, "ChromeOS"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Linux/, "Linux"],
];

// A small User-Agent reader for the "Logged-in devices" list. Only a label for
// people to recognise their devices; nothing is decided from it.
export const describeDevice = (userAgent = ""): DeviceInfo => {
	const tablet =
		/iPad|Tablet/.test(userAgent) ||
		(/Android/.test(userAgent) && !/Mobile/.test(userAgent));
	return {
		browser: first(userAgent, BROWSERS, "Unknown browser"),
		os: first(userAgent, SYSTEMS, "Unknown system"),
		deviceType: tablet
			? "tablet"
			: /Mobi|iPhone|iPod/.test(userAgent)
				? "mobile"
				: "desktop",
	};
};

// One entry of GET /api/me/sessions (and of a DEVICE_LIMIT error's `devices`)
export const toDeviceResponse = (
	session: LoginSession,
	currentId?: string,
) => ({
	id: session.id,
	browser: session.browser,
	os: session.os,
	deviceType: session.deviceType as DeviceType,
	ip: session.ip,
	createdAt: session.createdAt.toISOString(),
	lastSeenAt: session.lastSeenAt.toISOString(),
	current: session.id === currentId,
});
