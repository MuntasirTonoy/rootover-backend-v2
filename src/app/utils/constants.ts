// Enum values as runtime arrays, in the order the frontend shows them
export const LEVELS = ["SSC", "HSC", "BSc", "BBA", "BA", "Others"] as const;
export const COURSE_STATUSES = [
	"draft",
	"pending",
	"approved",
	"rejected",
	"suspended",
] as const;

// The preset avatars users can pick instead of uploading a photo (served to
// the frontend through GET /api/config)
export const AVATAR_PRESETS = [
	"Felix",
	"Aneka",
	"Zoe",
	"Jack",
	"Bella",
	"Shadow",
	"Ginger",
	"Midnight",
	"Luna",
	"Max",
	"Charlie",
	"Oliver",
	"Lucy",
	"Coco",
	"Milo",
].map((seed) => `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}`);
