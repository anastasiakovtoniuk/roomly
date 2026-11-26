import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { SESSION_COOKIE_NAME, type MeResponse } from '@roomly/shared';
import { createUser, TEST_PASSWORD } from './factories';

export function sessionCookieFrom(res: request.Response): string {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const cookies = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = cookies.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) throw new Error('Відповідь не встановила cookie сесії');
  return cookie.split(';', 1).join('');
}

// Реєстрація через API (як справжній студент): cookie автоматичного входу (Q08) і id користувача.
export async function registerStudent(app: Express, name = 'Олена') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email: `student-${randomUUID()}@example.com`, password: TEST_PASSWORD });
  expect(res.status).toBe(201);
  return { cookie: sessionCookieFrom(res), userId: (res.body as MeResponse).user.id };
}

// Адміністратор: публічної реєстрації немає (SYS-AC-08), тож користувач створюється напряму в БД,
// а сесія — справжнім входом через API.
export async function adminSession(app: Express) {
  const admin = await createUser({ role: 'admin', name: 'Адмін' });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: admin.email, password: admin.password });
  expect(res.status).toBe(200);
  return { cookie: sessionCookieFrom(res), userId: admin.id };
}
