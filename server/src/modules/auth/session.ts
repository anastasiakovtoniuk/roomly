import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_COOKIE_NAME } from '@roomly/shared';

// Сесія за ADR-0005 і data_model.md §3.5: у cookie — випадковий токен, у базі — лише його SHA-256,
// тож витік бази не дає робочих токенів.

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Без строку дії (TA-1): cookie живе до виходу. Secure — лише при HTTPS, щоб локальний HTTP працював.
// req.secure правдивий, лише коли TLS завершується на самому Express: у MVP проксі немає (ADR-0007).
// Для розгортання за TLS-проксі потрібен `app.set('trust proxy', …)`, інакше cookie піде без Secure.
function cookieOptions(req: Request): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure };
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(req));
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(req));
}

// Розбір заголовка Cookie без окремої залежності: потрібне лише одне значення.
export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;

    const value = pair.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}
