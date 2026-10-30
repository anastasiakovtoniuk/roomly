import type { ErrorBody, ErrorCode } from '@roomly/shared';

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

// Єдина обгортка над fetch для всіх запитів до /api (ADR-0002).
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const error = (body as ErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `HTTP ${res.status}`,
      error?.details,
    );
  }

  return body as T;
}
