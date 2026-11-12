import type { Request, RequestHandler } from 'express';
import type { User, UserRole } from '@roomly/shared';
import { AppError } from '../lib/appError';
import { findSessionUser } from '../modules/auth/auth.service';
import { readSessionToken } from '../modules/auth/session';

declare module 'express-serve-static-core' {
  interface Request {
    // Заповнює лише requireAuth із сесії в базі; клієнт не може його підставити (BR-17, FB-11).
    authUser?: User;
  }
}

// Будь-який захищений маршрут: без cookie або з невідомою сесією — 401 UNAUTHENTICATED.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readSessionToken(req);
  const user = token ? await findSessionUser(token) : null;

  if (!user) {
    next(new AppError('UNAUTHENTICATED', 'Потрібен вхід'));
    return;
  }
  req.authUser = user;
  next();
};

// Ставиться після requireAuth. Студентські й адміністративні маршрути взаємовиключні:
// інша роль отримує 403 FORBIDDEN (api_spec.md §1, BR-15, SYS-AC-09).
export function requireRole(role: UserRole): RequestHandler {
  return (req, _res, next) => {
    next(getAuthUser(req).role === role ? undefined : new AppError('FORBIDDEN', 'Недостатньо прав'));
  };
}

// Користувач поточного запиту для обробників після requireAuth.
export function getAuthUser(req: Request): User {
  if (!req.authUser) {
    throw new AppError('UNAUTHENTICATED', 'Потрібен вхід');
  }
  return req.authUser;
}
