// Значення й константи з docs/contracts/data_model.md §2 та api_spec.md §11.

export const BOOKING_STATUSES = ['active', 'confirmed', 'cancelled_by_student', 'auto_cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Статуси, що утримують слот (BR-1); та сама умова — у частковому індексі схеми Prisma.
export const LIVE_BOOKING_STATUSES = ['active', 'confirmed'] as const satisfies readonly BookingStatus[];

export const USER_ROLES = ['student', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CHECK_IN_RESULTS = ['confirmed', 'already_confirmed'] as const;
export type CheckInResultKind = (typeof CHECK_IN_RESULTS)[number];

export const BOOKING_SCOPES = ['upcoming', 'past'] as const;
export type BookingScope = (typeof BOOKING_SCOPES)[number];

// [Гіпотеза] H01: 15 хв; єдина константа для всіх кімнат — рішення команди.
export const GRACE_PERIOD_MINUTES = 15;

// TA-14; відкрите питання Q08.
export const PASSWORD_MIN_LENGTH = 8;

export const SESSION_COOKIE_NAME = 'roomly_session';
