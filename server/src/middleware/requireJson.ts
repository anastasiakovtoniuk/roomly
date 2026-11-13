import type { RequestHandler } from 'express';
import { AppError } from '../lib/appError';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Запити зі зміною даних приймаються лише як JSON (api_spec.md §1, ADR-0005): разом із SameSite=Lax
// це захист від CSRF, бо звичайна HTML-форма з іншого сайту не може надіслати application/json.
// Перевіряється заголовок, а не наявність тіла: logout без тіла теж має бути JSON-запитом.
export const requireJson: RequestHandler = (req, _res, next) => {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const mediaType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    next(
      new AppError('VALIDATION_ERROR', 'Некоректні дані запиту', {
        fields: [{ path: 'body', reason: 'invalid_content_type' }],
      }),
    );
    return;
  }
  next();
};
