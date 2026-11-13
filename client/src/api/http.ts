import { ERROR_CODES, type ErrorCode } from '@roomly/shared';

// Сервер відповів помилкою в єдиному форматі (docs/contracts/error_format.md).
// Текст для користувача клієнт обирає за code, а не за message.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Відповіді від сервера немає: запит не дійшов або відповідь втрачено.
// Для підтвердження це не означає «не збережено» (US-5.6a, Q11).
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Немає з’єднання з сервером', { cause });
    this.name = 'NetworkError';
  }
}

const unauthenticatedListeners = new Set<() => void>();

export function subscribeToUnauthenticated(listener: () => void): () => void {
  unauthenticatedListeners.add(listener);
  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

// Єдина обгортка над fetch для всіх запитів до /api (ADR-0002).
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
  } catch (err) {
    // Скасований запит при зміні екрана не є мережевою помилкою.
    if (init.signal?.aborted) throw err;
    throw new NetworkError(err);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (res.ok) throw new NetworkError(error);
    body = null;
  }

  if (!res.ok) {
    const error = parseError(body);
    // /me має власний захист від застарілих відповідей у AuthProvider.
    if (error?.code === 'UNAUTHENTICATED' && path !== '/auth/me') {
      unauthenticatedListeners.forEach((listener) => listener());
    }
    throw new ApiError(
      res.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `HTTP ${res.status}`,
      error?.details,
    );
  }

  if (!isRecord(body)) throw new NetworkError(new Error('Некоректна відповідь API'));
  return body as T;
}

function parseError(body: unknown): {
  code: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
} | null {
  if (!isRecord(body)) return null;
  const error = body.error;
  if (!isRecord(error)) return null;
  const code = ERROR_CODES.find((code) => code === error.code) ?? 'INTERNAL_ERROR';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
  const details = isRecord(error.details) ? error.details : undefined;
  return { code, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
