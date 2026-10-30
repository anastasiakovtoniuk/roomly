import { ERROR_HTTP_STATUS, type ErrorCode } from '@roomly/shared';

// Очікувана помилка з кодом із docs/contracts/error_format.md.
// Сервіси кидають її, а errorHandler перетворює на єдине тіло відповіді.
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_HTTP_STATUS[code];
  }
}
