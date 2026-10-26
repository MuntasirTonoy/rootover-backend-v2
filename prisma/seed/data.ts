// Fictional demo dataset, ported from the frontend's src/lib/seed.ts (same ids,
// names, structure and seeded random). Everything is made up: names, NID/TIN and
// bKash numbers, documents. Dates are relative to the moment the seed runs, so
// "last 7 days" sales and coupon expiry stay meaningful whenever it is re-run.
import {
	CLEARING_DAYS,
	quote,
	DEFAULT_COMMISSION_RATE,
	DEFAULT_REGISTRATION_FEE as REGISTRATION_FEE,
} from "../../src/app/utils/pricing.js";
import type {
	ActorRole,
	ApplicationStatus,
	CourseStatus,
	Level,
	PaymentMethod,
	PurchaseStatus,
	ReportEventType,
	ReportReason,
	ReportStatus,
	Role,
	UserStatus,
	WithdrawalStatus,
} from "../../src/generated/prisma/client.js";

const DAY = 24 * 60 * 60 * 1000;

export const DEMO_VIDEO = "https://www.youtube.com/embed/KDPZy2lBhik";

function seededRandom(seed: number) {
	let s = seed;
	return () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
}

export interface SeedUser {
	id: string;
	name: string;
	email: string;
	// Plain demo password; the seed stores only its bcrypt hash
	password: string;
	role: Role;
	status: UserStatus;
	phone?: string;
	institution?: string;
	createdAt: Date;
}

export function buildSeedData(now = Date.now()) {
	const daysAgo = (days: number) => new Date(now - days * DAY);
	const daysAhead = (days: number) => new Date(now + days * DAY);

	// ------------------------------------------------------------ users

	const admin: SeedUser = {
		id: "u-admin",
		name: "Platform Admin",
		email: "admin@rootover.demo",
		password: "Admin@123",
		role: "admin",
		status: "active",
		createdAt: daysAgo(500),
	};

	const teacherUsers: SeedUser[] = [
		["u-t1", "Dr. Rezaul Karim", "teacher@rootover.demo", "Teacher@123"],
		["u-t2", "Nazma Sultana", "nazma.sultana@rootover.demo", "Demo@123"],
		["u-t3", "Md. Arif Hossain", "arif.hossain@rootover.demo", "Demo@123"],
		[
			"u-t4",
			"Farzana Chowdhury",
			"farzana.chowdhury@rootover.demo",
			"Demo@123",
		],
	].map(([id, name, email, password], i) => ({
		id,
		name,
		email,
		password,
		role: "teacher",
		status: "active",
		phone: `0170000010${i + 1}`,
		createdAt: daysAgo(420 - i * 30),
	}));

	const studentNames = [
		"Tanvir Ahmed",
		"Nusrat Jahan",
		"Rafiul Islam",
		"Sadia Akter",
		"Imran Hossain",
		"Ayesha Rahman",
		"Mehedi Hasan",
		"Farhana Sultana",
		"Tasnim Chowdhury",
		"Arif Mahmud",
		"Sabbir Rahman",
		"Lamia Haque",
	];

	const studentUsers: SeedUser[] = studentNames.map((name, i) => ({
		id: `u-s${i + 1}`,
		name,
		email:
			i === 0
				? "student@rootover.demo"
				: `${name.toLowerCase().replace(" ", ".")}@rootover.demo`,
		password: i === 0 ? "Student@123" : "Demo@123",
		role: "student",
		// One banned account so the admin view has something to unban
		status: i === 10 ? "banned" : "active",
		institution: i === 0 ? "Dhaka College" : undefined,
		createdAt: daysAgo(300 - i * 15),
	}));

	const users = [admin, ...teacherUsers, ...studentUsers];
	const userByName = new Map(users.map((u) => [u.name, u]));

	// ------------------------------------------------------------ teachers

	const teachers = [
		{
			id: "t1",
			userId: "u-t1",
			teacherCode: "RO-T-26-0101",
			featured: true,
			headline: "Physics & Mathematics educator",
			bio: "Teaching physics for over a decade with a focus on building intuition before formulas. Former board examiner for SSC and HSC physics.",
			qualifications: [
				"PhD in Physics (fictional)",
				"MSc in Applied Physics",
				"Former board examiner",
			],
			institution: "Demo University of Dhaka",
			experienceYears: 12,
			joinedAt: daysAgo(400),
		},
		{
			id: "t2",
			userId: "u-t2",
			teacherCode: "RO-T-26-0102",
			featured: true,
			headline: "Chemistry made simple",
			bio: "Associate professor who loves turning reaction mechanisms into stories students remember.",
			qualifications: ["MSc in Chemistry", "BSc (Hons) in Chemistry"],
			institution: "Demo Jahangirnagar University",
			experienceYears: 9,
			joinedAt: daysAgo(370),
		},
		{
			id: "t3",
			userId: "u-t3",
			teacherCode: "RO-T-26-0103",
			featured: true,
			headline: "Mathematics & programming mentor",
			bio: "Senior lecturer in engineering mathematics who also teaches beginners to write their first programs.",
			qualifications: ["MSc in Mathematics", "BSc in Computer Science"],
			institution: "Demo Engineering University",
			experienceYears: 7,
			joinedAt: daysAgo(340),
		},
		{
			id: "t4",
			userId: "u-t4",
			teacherCode: "RO-T-26-0104",
			headline: "Business studies & literature",
			bio: "Teaches accounting fundamentals to BBA students and English literature to BA students.",
			qualifications: ["MBA in Accounting", "MA in English Literature"],
			institution: "Demo University of Chittagong",
			experienceYears: 10,
			joinedAt: daysAgo(310),
		},
	];

	// ------------------------------------------------------------ courses

	interface CourseSeed {
		id: string;
		teacherId: string;
		level: Level;
		subject: string;
		title: string;
		description: string;
		price: number;
		discountPrice?: number;
		status: CourseStatus;
		statusNote?: string;
		featured?: boolean;
		createdDaysAgo: number;
		outcomes: string[];
		chapters: [string, string[]][];
	}

	const courseSeeds: CourseSeed[] = [
		{
			id: "c-ssc-physics",
			teacherId: "t1",
			level: "SSC",
			subject: "Physics",
			title: "SSC Physics: Complete Course",
			description:
				"Everything in the SSC physics syllabus, from measurement to energy, with solved board questions in every chapter.",
			price: 1500,
			discountPrice: 1200,
			status: "approved",
			featured: true,
			createdDaysAgo: 200,
			outcomes: [
				"Solve motion and force problems confidently",
				"Understand every SSC physics chapter",
				"Practise with past board questions",
			],
			chapters: [
				[
					"Physical Quantities & Measurement",
					[
						"Units and dimensions",
						"Measuring instruments",
						"Errors in measurement",
					],
				],
				[
					"Motion",
					[
						"Rest and motion",
						"Speed, velocity and acceleration",
						"Equations of motion",
					],
				],
				[
					"Force",
					["Newton's laws of motion", "Momentum and impulse", "Friction"],
				],
				[
					"Work, Power & Energy",
					["Work and energy", "Power", "Conservation of energy"],
				],
			],
		},
		{
			id: "c-hsc-physics",
			teacherId: "t1",
			level: "HSC",
			subject: "Physics",
			title: "HSC Physics 1st Paper",
			description:
				"Vectors, dynamics, gravitation and waves for HSC students, explained step by step.",
			price: 2000,
			discountPrice: 1600,
			status: "approved",
			createdDaysAgo: 150,
			outcomes: [
				"Work comfortably with vectors",
				"Apply Newtonian mechanics",
				"Master gravitation problems",
			],
			chapters: [
				[
					"Vectors",
					["Scalars and vectors", "Vector addition", "Dot and cross product"],
				],
				[
					"Dynamics",
					["Newton's laws revisited", "Circular motion", "Rotational dynamics"],
				],
				[
					"Gravitation",
					["Universal law of gravitation", "Satellites and orbits"],
				],
			],
		},
		{
			id: "c-hsc-highermath",
			teacherId: "t1",
			level: "HSC",
			subject: "Higher Mathematics",
			title: "HSC Higher Mathematics 1st Paper",
			description:
				"Matrices, straight lines, circles and trigonometry with a large problem bank.",
			price: 1800,
			status: "pending",
			createdDaysAgo: 6,
			outcomes: [
				"Solve matrix and determinant problems",
				"Handle coordinate geometry",
			],
			chapters: [
				[
					"Matrices & Determinants",
					["Types of matrices", "Determinants", "Inverse matrix"],
				],
				["Straight Lines", ["Slope and intercepts", "Distance formulas"]],
			],
		},
		{
			id: "c-ssc-math",
			teacherId: "t1",
			level: "SSC",
			subject: "General Mathematics",
			title: "SSC General Mathematics Crash Course",
			description: "A fast revision course for SSC general mathematics.",
			price: 1000,
			status: "draft",
			createdDaysAgo: 2,
			outcomes: ["Revise algebra quickly"],
			chapters: [["Algebra", ["Algebraic expressions", "Factorisation"]]],
		},
		{
			id: "c-hsc-chemistry",
			teacherId: "t2",
			level: "HSC",
			subject: "Chemistry",
			title: "HSC Chemistry 2nd Paper",
			description:
				"Organic chemistry, quantitative chemistry and electrochemistry for HSC.",
			price: 1800,
			discountPrice: 1500,
			status: "approved",
			featured: true,
			createdDaysAgo: 180,
			outcomes: [
				"Name and draw organic compounds",
				"Balance redox reactions",
				"Solve mole calculations",
			],
			chapters: [
				["Environmental Chemistry", ["Gas laws", "Ideal and real gases"]],
				[
					"Organic Chemistry",
					["Hydrocarbons", "Functional groups", "Reaction mechanisms"],
				],
				["Quantitative Chemistry", ["The mole concept", "Titration"]],
				["Electrochemistry", ["Electrolysis", "Galvanic cells"]],
			],
		},
		{
			id: "c-bsc-organic",
			teacherId: "t2",
			level: "BSc",
			subject: "Organic Chemistry",
			title: "BSc Organic Chemistry I",
			description:
				"Stereochemistry and reaction mechanisms for first-year chemistry honours students.",
			price: 2500,
			status: "approved",
			createdDaysAgo: 120,
			outcomes: ["Assign R/S configurations", "Predict SN1/SN2 outcomes"],
			chapters: [
				["Stereochemistry", ["Chirality", "R/S nomenclature", "Conformations"]],
				["Substitution Reactions", ["SN1 mechanism", "SN2 mechanism"]],
				["Elimination Reactions", ["E1 and E2", "Zaitsev's rule"]],
			],
		},
		{
			id: "c-bsc-calculus",
			teacherId: "t3",
			level: "BSc",
			subject: "Calculus",
			title: "BSc Calculus I",
			description:
				"Limits, derivatives and integrals for first-year science and engineering students.",
			price: 2200,
			discountPrice: 1800,
			status: "approved",
			featured: true,
			createdDaysAgo: 170,
			outcomes: [
				"Evaluate limits",
				"Differentiate any elementary function",
				"Apply integration techniques",
			],
			chapters: [
				[
					"Limits & Continuity",
					["Intuitive limits", "Limit laws", "Continuity"],
				],
				[
					"Differentiation",
					[
						"Derivative definition",
						"Chain rule",
						"Applications of derivatives",
					],
				],
				[
					"Integration",
					["Antiderivatives", "Integration by parts", "Definite integrals"],
				],
			],
		},
		{
			id: "c-other-c",
			teacherId: "t3",
			level: "Others",
			subject: "Programming",
			title: "Programming in C for Beginners",
			description:
				"Learn programming from zero with C: variables, loops, functions, arrays and pointers.",
			price: 1200,
			discountPrice: 999,
			status: "approved",
			createdDaysAgo: 90,
			outcomes: [
				"Write and compile C programs",
				"Use loops and functions",
				"Understand pointers",
			],
			chapters: [
				["Getting Started", ["Installing a compiler", "Your first program"]],
				["Control Flow", ["If/else", "Loops", "Switch statements"]],
				[
					"Functions & Arrays",
					["Writing functions", "Arrays", "Pointers basics"],
				],
			],
		},
		{
			id: "c-other-spoken",
			teacherId: "t3",
			level: "Others",
			subject: "Spoken English",
			title: "Spoken English Basics",
			description: "Everyday conversation practice for beginners.",
			price: 800,
			status: "rejected",
			statusNote:
				"Several lesson videos are private or unavailable. Please update the links and resubmit.",
			createdDaysAgo: 20,
			outcomes: ["Hold simple conversations"],
			chapters: [["Introductions", ["Greetings", "Talking about yourself"]]],
		},
		{
			id: "c-bba-accounting",
			teacherId: "t4",
			level: "BBA",
			subject: "Accounting",
			title: "Principles of Accounting",
			description:
				"Journal entries, ledgers, trial balance and financial statements for BBA first year.",
			price: 2000,
			status: "approved",
			featured: true,
			createdDaysAgo: 160,
			outcomes: [
				"Record journal entries",
				"Prepare a trial balance",
				"Read financial statements",
			],
			chapters: [
				["Accounting Basics", ["The accounting equation", "Debit and credit"]],
				["The Accounting Cycle", ["Journal", "Ledger", "Trial balance"]],
				["Financial Statements", ["Income statement", "Balance sheet"]],
			],
		},
		{
			id: "c-ba-english",
			teacherId: "t4",
			level: "BA",
			subject: "English Literature",
			title: "English Literature: Romantic Poetry",
			description:
				"Wordsworth, Coleridge, Keats and Shelley: close readings and exam-ready analysis.",
			price: 1500,
			discountPrice: 1200,
			status: "approved",
			createdDaysAgo: 110,
			outcomes: ["Analyse romantic poems", "Write strong literature answers"],
			chapters: [
				["The Romantic Movement", ["Historical context", "Key themes"]],
				[
					"Wordsworth & Coleridge",
					["Tintern Abbey", "The Rime of the Ancient Mariner"],
				],
				["Keats & Shelley", ["Ode to a Nightingale", "Ode to the West Wind"]],
			],
		},
	];

	// Lessons with downloadable notes (BACKEND_SPEC section 13); fictional URLs
	const NOTE_COURSES = new Set([
		"c-ssc-physics",
		"c-hsc-chemistry",
		"c-other-c",
	]);

	// Star ratings for approved courses (kept only as totals per course)
	const ratingPool = [5, 4, 5, 4, 5];

	const courses = courseSeeds.map((seed, i) => {
		const chapters = seed.chapters.map(([title, lessons], ci) => ({
			id: `${seed.id}-ch${ci + 1}`,
			title,
			position: ci,
			lessons: lessons.map((lessonTitle, li) => {
				const id = `${seed.id}-ch${ci + 1}-l${li + 1}`;
				return {
					id,
					title: lessonTitle,
					durationMin: 10 + ((ci * 7 + li * 5) % 20),
					videoUrl: DEMO_VIDEO,
					noteLink:
						NOTE_COURSES.has(seed.id) && li === 0
							? `https://example.com/notes/${id}.pdf`
							: null,
					isPreview: ci === 0 && li === 0,
					position: li,
				};
			}),
		}));
		const ratings =
			seed.status === "approved"
				? ratingPool
						.slice(0, 2 + (i % 3))
						.map((rating, r) => ((i + r) % 4 === 0 ? 4 : rating))
				: [];
		return {
			id: seed.id,
			teacherId: seed.teacherId,
			level: seed.level,
			subject: seed.subject,
			title: seed.title,
			description: seed.description,
			outcomes: seed.outcomes,
			price: seed.price,
			discountPrice: seed.discountPrice ?? null,
			status: seed.status,
			statusNote: seed.statusNote ?? null,
			featured: seed.featured ?? false,
			createdAt: daysAgo(seed.createdDaysAgo),
			updatedAt: daysAgo(Math.max(0, seed.createdDaysAgo - 5)),
			ratingSum: ratings.reduce((s, r) => s + r, 0),
			ratingCount: ratings.length,
			chapters,
		};
	});
	type SeedCourse = (typeof courses)[number];
	const lessonsOf = (course: SeedCourse) =>
		course.chapters.flatMap((ch) => ch.lessons);

	// ------------------------------------------------------------ coupons

	const coupons = [
		{
			id: "cp1",
			teacherId: "t1",
			code: "PHYSICS20",
			type: "percent",
			value: 20,
			courseId: "c-ssc-physics",
			expiresAt: daysAhead(365),
			usageLimit: 100,
			usedCount: 0,
			active: true,
			createdAt: daysAgo(120),
		},
		{
			id: "cp2",
			teacherId: "t1",
			code: "KARIM100",
			type: "fixed",
			value: 100,
			courseId: null,
			expiresAt: daysAhead(365),
			usageLimit: 50,
			usedCount: 0,
			active: true,
			createdAt: daysAgo(90),
		},
		{
			id: "cp3",
			teacherId: "t1",
			code: "EID25",
			type: "percent",
			value: 25,
			courseId: null,
			expiresAt: daysAgo(40),
			usageLimit: 200,
			usedCount: 0,
			active: true,
			createdAt: daysAgo(150),
		},
		{
			id: "cp4",
			teacherId: "t2",
			code: "CHEM15",
			type: "percent",
			value: 15,
			courseId: "c-hsc-chemistry",
			expiresAt: daysAhead(365),
			usageLimit: 80,
			usedCount: 0,
			active: true,
			createdAt: daysAgo(100),
		},
		{
			id: "cp5",
			teacherId: "t3",
			code: "CODE50",
			type: "fixed",
			value: 50,
			courseId: "c-other-c",
			expiresAt: daysAhead(365),
			usageLimit: 20,
			usedCount: 0,
			active: true,
			createdAt: daysAgo(60),
		},
		{
			id: "cp6",
			teacherId: "t4",
			code: "ACCOUNT10",
			type: "percent",
			value: 10,
			courseId: null,
			expiresAt: daysAhead(365),
			usageLimit: 100,
			usedCount: 0,
			active: false,
			createdAt: daysAgo(80),
		},
	] satisfies {
		id: string;
		teacherId: string;
		code: string;
		type: "percent" | "fixed";
		value: number;
		courseId: string | null;
		expiresAt: Date;
		usageLimit: number;
		usedCount: number;
		active: boolean;
		createdAt: Date;
	}[];

	// ------------------------------------------------------------ purchases & enrollments

	const methods: PaymentMethod[] = ["bKash", "bKash", "Nagad", "Card"];

	interface SeedPurchase {
		id: string;
		studentId: string;
		courseId: string;
		teacherId: string;
		listPrice: number;
		coursePrice: number;
		couponCode: string | null;
		couponDiscount: number;
		amountPaid: number;
		commission: number;
		teacherNet: number;
		method: PaymentMethod;
		trxId: string;
		status: PurchaseStatus;
		createdAt: Date;
	}
	interface SeedEnrollment {
		id: string;
		studentId: string;
		courseId: string;
		purchaseId: string;
		enrolledAt: Date;
		completedLessonIds: string[];
		lastLessonId: string | null;
		lastWatchedAt: Date | null;
	}

	const purchases: SeedPurchase[] = [];
	const enrollments: SeedEnrollment[] = [];

	function addPurchase(
		studentId: string,
		course: SeedCourse,
		days: number,
		couponCode: string | undefined,
		index: number,
		status: PurchaseStatus = "completed",
	) {
		const coupon = couponCode
			? coupons.find((c) => c.code === couponCode)
			: undefined;
		if (coupon) coupon.usedCount += 1;
		const q = quote(course, coupon, DEFAULT_COMMISSION_RATE);
		const id = `p-${purchases.length + 1}`;
		purchases.push({
			id,
			studentId,
			courseId: course.id,
			teacherId: course.teacherId,
			listPrice: q.listPrice,
			coursePrice: q.coursePrice,
			couponCode: coupon?.code ?? null,
			couponDiscount: q.couponDiscount,
			amountPaid: q.total,
			commission: q.commission,
			teacherNet: q.teacherNet,
			method: methods[index % methods.length],
			trxId: `DEMOTRX${(100000 + purchases.length * 7919).toString(36).toUpperCase()}`,
			status,
			createdAt: daysAgo(days),
		});
		return id;
	}

	const courseById = (id: string) => {
		const course = courses.find((c) => c.id === id);
		if (!course) throw new Error(`Unknown seed course ${id}`);
		return course;
	};
	const approvedCourses = courses.filter((c) => c.status === "approved");
	const rand = seededRandom(42);

	// The demo student's purchases are fixed so the student pages look intentional
	const demoStudentPlan: [string, number, string | undefined][] = [
		["c-ssc-physics", 40, "PHYSICS20"],
		["c-hsc-physics", 25, undefined],
		["c-hsc-chemistry", 60, "CHEM15"],
		["c-bba-accounting", 4, undefined],
	];

	for (const [courseId, days, coupon] of demoStudentPlan) {
		const purchaseId = addPurchase(
			"u-s1",
			courseById(courseId),
			days,
			coupon,
			purchases.length,
		);
		enrollments.push({
			id: `e-${enrollments.length + 1}`,
			studentId: "u-s1",
			courseId,
			purchaseId,
			enrolledAt: daysAgo(days),
			completedLessonIds: [],
			lastLessonId: null,
			lastWatchedAt: null,
		});
	}

	const otherStudents = studentUsers.slice(1).map((u) => u.id);
	approvedCourses.forEach((course, i) => {
		const buyerCount = 4 + ((i * 3) % 6);
		for (let k = 0; k < buyerCount; k++) {
			const studentId = otherStudents[(i * 2 + k * 3) % otherStudents.length];
			if (
				purchases.some(
					(p) => p.studentId === studentId && p.courseId === course.id,
				)
			)
				continue;
			// The first sale of each course is recent so some earnings are still clearing
			const days = k === 0 ? 1 + (i % 5) : 8 + Math.floor(rand() * 160);
			const applicable = coupons.filter(
				(c) =>
					c.teacherId === course.teacherId &&
					(!c.courseId || c.courseId === course.id),
			);
			const coupon =
				applicable.length && rand() < 0.35 ? applicable[0].code : undefined;
			const refunded = i === 2 && k === 2;
			const purchaseId = addPurchase(
				studentId,
				course,
				days,
				coupon,
				purchases.length,
				refunded ? "refunded" : "completed",
			);
			// A refunded purchase keeps its record but grants no enrollment
			if (refunded) continue;
			const lessons = lessonsOf(course);
			const done = Math.floor(rand() * (lessons.length + 1));
			enrollments.push({
				id: `e-${enrollments.length + 1}`,
				studentId,
				courseId: course.id,
				purchaseId,
				enrolledAt: daysAgo(days),
				completedLessonIds: lessons.slice(0, done).map((l) => l.id),
				lastLessonId: done
					? lessons[Math.min(done, lessons.length - 1)].id
					: null,
				lastWatchedAt: done ? daysAgo(Math.max(0, days - 3)) : null,
			});
		}
	});

	// Demo student progress: one in progress, one barely started, one finished, one new
	function setProgress(
		courseId: string,
		completed: number,
		lastWatchedDaysAgo?: number,
	) {
		const enrollment = enrollments.find(
			(e) => e.studentId === "u-s1" && e.courseId === courseId,
		);
		if (!enrollment) throw new Error(`No demo enrollment for ${courseId}`);
		const lessons = lessonsOf(courseById(courseId));
		enrollment.completedLessonIds = lessons
			.slice(0, completed)
			.map((l) => l.id);
		if (lastWatchedDaysAgo !== undefined) {
			enrollment.lastLessonId =
				lessons[Math.min(completed, lessons.length - 1)].id;
			enrollment.lastWatchedAt = daysAgo(lastWatchedDaysAgo);
		}
	}
	setProgress("c-ssc-physics", 7, 0.5);
	setProgress("c-hsc-physics", 2, 2);
	setProgress("c-hsc-chemistry", 9, 10);

	const savedLessons = (
		[
			["c-ssc-physics", "c-ssc-physics-ch2-l3", 3],
			["c-ssc-physics", "c-ssc-physics-ch3-l1", 1],
			["c-hsc-physics", "c-hsc-physics-ch1-l2", 5],
			["c-hsc-chemistry", "c-hsc-chemistry-ch2-l3", 12],
		] as [string, string, number][]
	).map(([courseId, lessonId, days], i) => ({
		id: `sv-${i + 1}`,
		studentId: "u-s1",
		courseId,
		lessonId,
		savedAt: daysAgo(days),
	}));

	// ------------------------------------------------------------ applications & fees

	// Placeholder document metadata only; no file is uploaded for seed data
	const doc = (name: string, type = "application/pdf", size = 240_000) => ({
		name,
		type,
		size,
	});

	function application(
		id: string,
		userId: string,
		fullName: string,
		n: number,
		status: ApplicationStatus,
		submittedDaysAgo: number,
		extra: { teacherId?: string; reviewNote?: string } = {},
	) {
		return {
			id,
			userId,
			fullName,
			// Obviously fictional identifiers
			nid: `99900000${String(n).padStart(4, "0")}`,
			bkashNumber: `017000${String(n).padStart(5, "0")}`,
			tin: `000000${String(n).padStart(6, "0")}`,
			dateOfBirth: `19${85 + (n % 10)}-0${1 + (n % 9)}-15`,
			gender: n % 2 ? "female" : "male",
			photo: doc("profile-photo.jpg", "image/jpeg", 120_000),
			sscCertificate: doc("ssc-certificate.pdf"),
			hscCertificate: doc("hsc-certificate.pdf"),
			fatherVoterId: doc("father-voter-id.jpg", "image/jpeg", 180_000),
			status,
			submittedAt: daysAgo(submittedDaysAgo),
			updatedAt: daysAgo(Math.max(0, submittedDaysAgo - 2)),
			teacherId: extra.teacherId ?? null,
			reviewNote: extra.reviewNote ?? null,
		};
	}

	const applications = [
		...teachers.map((t, i) =>
			application(
				`app-t${i + 1}`,
				t.userId,
				teacherUsers[i].name,
				101 + i,
				"approved",
				410 - i * 30,
				{ teacherId: t.id },
			),
		),
		application("app-s2", "u-s2", "Nusrat Jahan", 202, "pending_review", 2),
		application("app-s3", "u-s3", "Rafiul Islam", 203, "payment_required", 5),
		application("app-s4", "u-s4", "Sadia Akter", 204, "under_verification", 6),
		application("app-s5", "u-s5", "Imran Hossain", 205, "rejected", 15, {
			reviewNote:
				"The uploaded certificates are unreadable. Please upload clear scans and apply again.",
		}),
	];

	const registrationFees = applications
		.filter((a) => a.status === "approved" || a.status === "under_verification")
		.map((a, i) => ({
			id: `fee-${i + 1}`,
			applicationId: a.id,
			userId: a.userId,
			amount: REGISTRATION_FEE,
			method: "bKash" as const,
			payerNumber: a.bkashNumber,
			trxId: `DEMOFEE${(5000 + i * 37).toString(36).toUpperCase()}`,
			paidAt: daysAgo(a.status === "approved" ? 405 - i * 30 : 3),
		}));

	// ------------------------------------------------------------ withdrawals

	const withdrawals: {
		id: string;
		teacherId: string;
		amount: number;
		method: "bKash";
		accountNumber: string;
		status: WithdrawalStatus;
		requestedAt: Date;
		processedAt: Date | null;
		note: string | null;
	}[] = [];
	teachers.forEach((t, i) => {
		// Only cleared sales back a withdrawal, so seeded payouts never exceed what was withdrawable
		const cleared = purchases
			.filter(
				(p) =>
					p.teacherId === t.id &&
					p.status === "completed" &&
					now - p.createdAt.getTime() > CLEARING_DAYS * DAY,
			)
			.reduce((sum, p) => sum + p.teacherNet, 0);
		const roundDown = (n: number) => Math.floor(n / 100) * 100;
		const bkash = applications.find((a) => a.userId === t.userId)?.bkashNumber;
		if (!bkash) throw new Error(`No application for ${t.id}`);
		const entries: [number, WithdrawalStatus, number, string?][] = [
			[roundDown(cleared * 0.35), "approved", 50 - i * 5],
			[roundDown(cleared * 0.15), "pending", 2 + i],
		];
		if (i === 0)
			entries.push([
				roundDown(cleared * 0.9),
				"rejected",
				20,
				"Amount exceeded the withdrawable balance at the time of request.",
			]);
		for (const [amount, status, days, note] of entries) {
			if (amount < 500) continue;
			withdrawals.push({
				id: `w-${withdrawals.length + 1}`,
				teacherId: t.id,
				amount,
				method: "bKash",
				accountNumber: bkash,
				status,
				requestedAt: daysAgo(days),
				processedAt: status === "pending" ? null : daysAgo(days - 1),
				note: note ?? null,
			});
		}
	});

	// ------------------------------------------------------------ video reports

	const userIdOf = (name: string) => userByName.get(name)?.id ?? null;
	const teacherUserOf = (teacherId: string) => {
		const t = teachers.find((x) => x.id === teacherId);
		const u = t && users.find((x) => x.id === t.userId);
		if (!u) throw new Error(`Unknown teacher ${teacherId}`);
		return u;
	};
	const userById = (id: string) => {
		const u = users.find((x) => x.id === id);
		if (!u) throw new Error(`Unknown user ${id}`);
		return u;
	};

	// One report per status so the teacher and admin screens have something to act on
	const reportSeeds: {
		lessonId: string;
		reporterId: string;
		reason: ReportReason;
		status: ReportStatus;
		reported: number;
		description?: string;
		fix?: [number, string];
		reject?: [number, string];
		approve?: [number, string];
	}[] = [
		{
			lessonId: "c-ssc-physics-ch2-l2",
			reporterId: "u-s1",
			reason: "AUDIO_ISSUE",
			status: "open",
			reported: 1,
		},
		{
			lessonId: "c-ssc-physics-ch1-l2",
			reporterId: "u-s1",
			reason: "VIDEO_ISSUE",
			status: "fix_submitted",
			reported: 6,
			fix: [2, "Re-uploaded the video in 1080p and replaced the link."],
		},
		{
			lessonId: "c-hsc-physics-ch1-l1",
			reporterId: "u-s7",
			reason: "BROKEN_LINK",
			status: "fix_rejected",
			reported: 9,
			fix: [6, "Changed the video to public."],
			reject: [
				5,
				"The video is still private. Set it to Unlisted and update the lesson link.",
			],
		},
		{
			lessonId: "c-bsc-calculus-ch1-l1",
			reporterId: "u-s6",
			reason: "WRONG_CONTENT",
			status: "resolved",
			reported: 30,
			fix: [
				27,
				"Replaced the video with the correct lecture on intuitive limits.",
			],
			approve: [25, "Verified, the correct video is now linked."],
		},
		{
			lessonId: "c-hsc-chemistry-ch1-l1",
			reporterId: "u-s9",
			reason: "OTHER",
			status: "open",
			reported: 3,
			description:
				"The slides in the second half of the video are cut off and can't be read.",
		},
	];

	const videoReports = reportSeeds.map((r, i) => {
		const course = courses.find((c) => r.lessonId.startsWith(`${c.id}-`));
		if (!course) throw new Error(`No course for lesson ${r.lessonId}`);
		const reporter = userById(r.reporterId);
		const teacherUser = teacherUserOf(course.teacherId);
		const events: {
			id: string;
			type: ReportEventType;
			actorId: string | null;
			actorName: string;
			actorRole: ActorRole;
			note: string | null;
			at: Date;
		}[] = [
			{
				id: `vre-${i}-1`,
				type: "reported",
				actorId: reporter.id,
				actorName: reporter.name,
				actorRole: "student",
				note: r.description ?? null,
				at: daysAgo(r.reported),
			},
		];
		if (r.fix)
			events.push({
				id: `vre-${i}-2`,
				type: "fix_submitted",
				actorId: teacherUser.id,
				actorName: teacherUser.name,
				actorRole: "teacher",
				note: r.fix[1],
				at: daysAgo(r.fix[0]),
			});
		if (r.reject)
			events.push({
				id: `vre-${i}-3`,
				type: "fix_rejected",
				actorId: admin.id,
				actorName: admin.name,
				actorRole: "admin",
				note: r.reject[1],
				at: daysAgo(r.reject[0]),
			});
		if (r.approve)
			events.push({
				id: `vre-${i}-3`,
				type: "fix_approved",
				actorId: admin.id,
				actorName: admin.name,
				actorRole: "admin",
				note: r.approve[1],
				at: daysAgo(r.approve[0]),
			});
		return {
			id: `vr-${i + 1}`,
			lessonId: r.lessonId,
			courseId: course.id,
			teacherId: course.teacherId,
			reporterId: r.reporterId,
			reason: r.reason,
			description: r.description ?? null,
			status: r.status,
			teacherNote: r.fix?.[1] ?? null,
			adminNote: r.reject?.[1] ?? r.approve?.[1] ?? null,
			fixSubmittedAt: r.fix ? daysAgo(r.fix[0]) : null,
			resolvedAt: r.approve ? daysAgo(r.approve[0]) : null,
			createdAt: daysAgo(r.reported),
			updatedAt: events[events.length - 1].at,
			events,
		};
	});

	// ------------------------------------------------------------ activity log

	// Action texts and targets follow BACKEND_SPEC section 12
	const activityLogs = (
		[
			[
				"Nusrat Jahan",
				"student",
				"Submitted a teacher application",
				"Nusrat Jahan",
				2,
			],
			[
				"Dr. Rezaul Karim",
				"teacher",
				"Submitted a course for approval",
				"HSC Higher Mathematics 1st Paper",
				6,
			],
			[
				"Sadia Akter",
				"student",
				"Paid the teacher registration fee (simulated)",
				`৳${REGISTRATION_FEE} via bKash`,
				3,
			],
			[
				"Platform Admin",
				"admin",
				"Requested registration fee",
				"Rafiul Islam",
				4,
			],
			[
				"Platform Admin",
				"admin",
				"Rejected course",
				"Spoken English Basics",
				18,
			],
			[
				"Platform Admin",
				"admin",
				"Rejected teacher application",
				"Imran Hossain",
				13,
			],
			["Platform Admin", "admin", "Banned user", "Sabbir Rahman", 25],
			[
				"Platform Admin",
				"admin",
				"Approved withdrawal",
				"Dr. Rezaul Karim",
				49,
			],
			[
				"Tanvir Ahmed",
				"student",
				"Purchased a course (simulated payment)",
				"Principles of Accounting",
				4,
			],
			[
				"Platform Admin",
				"admin",
				"Approved course",
				"Programming in C for Beginners",
				88,
			],
		] as [string, ActorRole, string, string, number][]
	).map(([actorName, actorRole, action, target, days], i) => ({
		id: `log-${i + 1}`,
		actorId: userIdOf(actorName),
		actorName,
		actorRole,
		action,
		target,
		at: daysAgo(days),
	}));

	return {
		users,
		teachers,
		applications,
		registrationFees,
		courses,
		coupons,
		purchases,
		enrollments,
		savedLessons,
		withdrawals,
		videoReports,
		activityLogs,
	};
}

export type SeedData = ReturnType<typeof buildSeedData>;
