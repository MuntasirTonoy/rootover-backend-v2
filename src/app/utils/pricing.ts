// Single source of truth for money maths (BACKEND_SPEC section 6). The
// frontend has no copy: it reads prices and quotes from the API and these
// constants from GET /api/config. All amounts are integer BDT.

// Defaults for the admin-editable settings (modules/settings); the live values
// come from SettingsService.get()
export const DEFAULT_COMMISSION_RATE = 0.1;
export const DEFAULT_REGISTRATION_FEE = 300;
// Sales stay in "pending clearance" this many days before they can be withdrawn
export const CLEARING_DAYS = 7;
export const MIN_WITHDRAWAL = 500;

type Priced = { price: number; discountPrice?: number | null };
type CouponValue = { type: "percent" | "fixed"; value: number };

// Price the student pays before any coupon
export function coursePrice(course: Priced): number {
	return course.discountPrice && course.discountPrice < course.price
		? course.discountPrice
		: course.price;
}

export function discountPercent(course: Priced): number {
	const effective = coursePrice(course);
	return course.price > 0
		? Math.round((1 - effective / course.price) * 100)
		: 0;
}

// Commission is the platform rate (10% by default) of what the student actually
// paid, after all discounts
export function splitSale(amountPaid: number, commissionRate: number) {
	const commission = Math.round(amountPaid * commissionRate);
	return { commission, teacherNet: amountPaid - commission };
}

export function couponDiscount(base: number, coupon: CouponValue): number {
	const raw =
		coupon.type === "percent"
			? Math.round((base * coupon.value) / 100)
			: coupon.value;
	return Math.max(0, Math.min(raw, base));
}

export interface Quote {
	listPrice: number;
	coursePrice: number;
	courseDiscount: number;
	couponDiscount: number;
	total: number;
	commission: number;
	teacherNet: number;
}

export function quote(
	course: Priced,
	coupon: CouponValue | null | undefined,
	commissionRate: number,
): Quote {
	const base = coursePrice(course);
	const off = coupon ? couponDiscount(base, coupon) : 0;
	const total = base - off;
	return {
		listPrice: course.price,
		coursePrice: base,
		courseDiscount: course.price - base,
		couponDiscount: off,
		total,
		...splitSale(total, commissionRate),
	};
}

// ---------------------------------------------------------------- coupons

export interface CouponRow extends CouponValue {
	id: string;
	teacherId: string;
	code: string;
	courseId: string | null;
	active: boolean;
	expiresAt: Date;
	usageLimit: number;
	usedCount: number;
}

export type CouponCheck<C extends CouponRow = CouponRow> =
	| { ok: true; coupon: C }
	| { ok: false; error: string };

// BACKEND_SPEC section 6, checked in this order (first failure wins). `coupons`
// are all coupons with this code (any teacher); codes compare case-insensitively.
export function checkCoupon<C extends CouponRow>(
	coupons: C[],
	course: { id: string; teacherId: string },
	code: string,
	now = Date.now(),
): CouponCheck<C> {
	const wanted = code.trim().toLowerCase();
	const matching = coupons.filter((c) => c.code.toLowerCase() === wanted);
	if (!matching.length)
		return { ok: false, error: "This coupon code doesn't exist." };
	// Codes are unique per teacher, so another teacher may use the same code
	const coupon = matching.find((c) => c.teacherId === course.teacherId);
	if (!coupon || (coupon.courseId && coupon.courseId !== course.id))
		return { ok: false, error: "This coupon isn't valid for this course." };
	if (!coupon.active)
		return { ok: false, error: "This coupon is no longer active." };
	if (coupon.expiresAt.getTime() < now)
		return { ok: false, error: "This coupon has expired." };
	if (coupon.usedCount >= coupon.usageLimit)
		return { ok: false, error: "This coupon has reached its usage limit." };
	return { ok: true, coupon };
}
