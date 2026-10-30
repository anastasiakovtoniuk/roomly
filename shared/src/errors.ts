// Єдиний формат помилок і перелік кодів — docs/contracts/error_format.md.
// Новий код додається спершу в контракт, потім сюди.

export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ROOM_NOT_FOUND: 404,
  SLOT_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  ENDPOINT_NOT_FOUND: 404,
  EMAIL_ALREADY_REGISTERED: 409,
  SLOT_ALREADY_BOOKED: 409,
  SLOT_NOT_BOOKABLE: 409,
  SLOT_OVERLAP: 409,
  BOOKING_STATUS_CONFLICT: 409,
  QR_UNKNOWN: 422,
  NO_CURRENT_BOOKING: 422,
  CHECK_IN_WINDOW_CLOSED: 422,
  CHECK_IN_TOO_EARLY: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as ErrorCode[];

export interface ValidationFieldError {
  path: string;
  reason: string;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}
