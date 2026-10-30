import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ErrorBody } from '@roomly/shared';
import { AppError } from '../lib/appError';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('ENDPOINT_NOT_FOUND', `Шлях ${req.method} ${req.baseUrl}${req.path} не існує`));
};

function isJsonSyntaxError(err: unknown): boolean {
  return err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed';
}

// Будь-яка помилка під /api повертається в одному форматі (error_format.md §1).
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (isJsonSyntaxError(err)) {
    appError = new AppError('VALIDATION_ERROR', 'Некоректні дані запиту', {
      fields: [{ path: 'body', reason: 'invalid_json' }],
    });
  } else {
    // Стек і внутрішні деталі — лише в журнал сервера, не у відповідь.
    console.error(err);
    appError = new AppError('INTERNAL_ERROR', 'Внутрішня помилка сервера');
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };
  res.status(appError.status).json(body);
};
