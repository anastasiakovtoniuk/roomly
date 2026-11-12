import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, type AuthUserResponse, type ErrorBody } from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { getAuthUser, requireAuth, requireRole } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';
import { hashSessionToken } from '../src/modules/auth/session';

const app = createApp();
const PASSWORD = 'secret-pass';

// Маршрути лише для тесту: студентських і адміністративних ендпоінтів ще немає,
// тому доступ сесії перевіряється на тих самих middleware, якими їх закриватимуть.
const guardedApp = express();
guardedApp.get('/student-only', requireAuth, requireRole('student'), (req, res) => {
  res.json({ userId: getAuthUser(req).id });
});
guardedApp.get('/admin-only', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ userId: getAuthUser(req).id });
});
guardedApp.use(errorHandler);

// Унікальна пошта на тест: тестова база спільна для всіх файлів і не очищується.
function uniqueEmail(name: string): string {
  return `${name}-${randomUUID()}@example.com`;
}

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

function sessionCookie(res: request.Response): string | undefined {
  return setCookies(res).find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
}

function sessionToken(res: request.Response): string {
  const cookie = sessionCookie(res);
  if (!cookie) throw new Error('Відповідь не встановила cookie сесії');
  return cookie
    .slice(SESSION_COOKIE_NAME.length + 1)
    .split(';', 1)
    .join('');
}

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function register(email: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/auth/register')
    .send({ name: 'Олена', email, password: PASSWORD, ...extra });
}

function errorCode(res: request.Response): string {
  return (res.body as ErrorBody).error.code;
}

describe('POST /api/auth/register', () => {
  it('US-1.2-AC-01 створює студента, відкриває сесію й ставить cookie HttpOnly, SameSite=Lax, Path=/', async () => {
    const email = uniqueEmail('olena');

    const res = await register(email);

    expect(res.status).toBe(201);
    expect((res.body as AuthUserResponse).user).toEqual({
      id: expect.any(String) as string,
      name: 'Олена',
      email,
      role: 'student',
    });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Expires|Max-Age/i);
  });

  it('US-1.2-AC-01 пароль і токен сесії не зберігаються у відкритому вигляді', async () => {
    const email = uniqueEmail('olena');

    const res = await register(email);
    const token = sessionToken(res);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { sessions: true } });
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
    expect(user.sessions.map((session) => session.tokenHash)).toEqual([hashSessionToken(token)]);
    expect(hashSessionToken(token)).not.toBe(token);
    expect(JSON.stringify(res.body)).not.toContain(user.passwordHash);
  });

  it('US-1.2-AC-01 нормалізує пошту, а повторна пошта в іншому регістрі дає 409 EMAIL_ALREADY_REGISTERED', async () => {
    const email = uniqueEmail('olena');

    const first = await register(`  ${email.toUpperCase()} `);
    const second = await register(email);

    expect(first.status).toBe(201);
    expect((first.body as AuthUserResponse).user.email).toBe(email);
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe('EMAIL_ALREADY_REGISTERED');
    expect(sessionCookie(second)).toBeUndefined();
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('US-1.2-AC-01 паралельна реєстрація однієї пошти створює один акаунт', async () => {
    const email = uniqueEmail('olena');

    const results = await Promise.all([register(email), register(email)]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('US-1.2-AC-01 некоректне тіло повертає 400 VALIDATION_ERROR без створення акаунта', async () => {
    const email = uniqueEmail('olena');

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Олена', email, password: 'short' });

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('US-1.2-AC-02 сесія після реєстрації має студентський доступ', async () => {
    const res = await register(uniqueEmail('olena'));

    const student = await request(guardedApp)
      .get('/student-only')
      .set('Cookie', cookieHeader(sessionToken(res)));

    expect(student.status).toBe(200);
    expect(student.body).toEqual({ userId: (res.body as AuthUserResponse).user.id });
  });

  it('US-1.2-AC-03 SYS-AC-08 роль admin із тіла ігнорується: створено студента без адміністративних прав', async () => {
    const email = uniqueEmail('olena');

    const res = await register(email, { role: 'admin' });
    const admin = await request(guardedApp)
      .get('/admin-only')
      .set('Cookie', cookieHeader(sessionToken(res)));

    expect(res.status).toBe(201);
    expect((res.body as AuthUserResponse).user.role).toBe('student');
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe('student');
    expect(admin.status).toBe(403);
    expect(errorCode(admin)).toBe('FORBIDDEN');
  });
});

describe('POST /api/auth/login', () => {
  it('US-X.1a-AC-01 вхід за даними реєстрації відкриває нову сесію студента', async () => {
    const email = uniqueEmail('olena');
    const registered = await register(email);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });
    const student = await request(guardedApp)
      .get('/student-only')
      .set('Cookie', cookieHeader(sessionToken(res)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(registered.body);
    expect(sessionCookie(res)).toMatch(/HttpOnly/i);
    expect(sessionToken(res)).not.toBe(sessionToken(registered));
    expect(student.status).toBe(200);
  });

  it('US-X.1a-AC-02 хибний пароль і неіснуюча пошта дають однакову відповідь 401 INVALID_CREDENTIALS без cookie', async () => {
    const email = uniqueEmail('olena');
    await register(email);

    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'wrong-pass' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('nobody'), password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(errorCode(wrongPassword)).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(sessionCookie(wrongPassword)).toBeUndefined();
    expect(sessionCookie(unknownEmail)).toBeUndefined();
  });

  it('SYS-AC-08 адміністратор, створений не через реєстрацію, входить і має лише адміністративний доступ', async () => {
    const email = uniqueEmail('admin');
    await prisma.user.create({
      data: { email, name: 'Адміністратор', role: 'admin', passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });

    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const cookie = cookieHeader(sessionToken(res));
    const admin = await request(guardedApp).get('/admin-only').set('Cookie', cookie);
    const student = await request(guardedApp).get('/student-only').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect((res.body as AuthUserResponse).user.role).toBe('admin');
    expect(admin.status).toBe(200);
    expect(student.status).toBe(403);
    expect(errorCode(student)).toBe('FORBIDDEN');
  });
});

describe('GET /api/auth/me', () => {
  it('UNAUTHENTICATED без cookie сесії', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });

  it('UNAUTHENTICATED з невідомим токеном сесії', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieHeader('forged-token'));

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/auth/logout', () => {
  it('US-X.1b-AC-01 видаляє сесію з бази й очищує cookie; старий токен більше не діє', async () => {
    const registered = await register(uniqueEmail('olena'));
    const token = sessionToken(registered);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Content-Type', 'application/json')
      .set('Cookie', cookieHeader(token));
    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(token));

    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
    expect(await prisma.session.count({ where: { tokenHash: hashSessionToken(token) } })).toBe(0);
    expect(me.status).toBe(401);
    expect(errorCode(me)).toBe('UNAUTHENTICATED');
  });

  it('US-X.1b-AC-02 після виходу повторне відкриття без входу не дає доступу; повторний вихід ідемпотентний', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ name: 'Олена', email: uniqueEmail('olena'), password: PASSWORD });

    const first = await agent.post('/api/auth/logout').set('Content-Type', 'application/json');
    const second = await agent.post('/api/auth/logout').set('Content-Type', 'application/json');
    const withoutCookie = await request(app).post('/api/auth/logout').set('Content-Type', 'application/json');
    const me = await agent.get('/api/auth/me');

    expect([first.status, second.status, withoutCookie.status]).toEqual([204, 204, 204]);
    expect(me.status).toBe(401);
  });

  it('US-X.1b-AC-03 інший студент на тому самому пристрої бачить лише себе; сесія попереднього не відновлюється', async () => {
    const agent = request.agent(app);
    const olenaEmail = uniqueEmail('olena');
    const bohdanEmail = uniqueEmail('bohdan');
    await register(bohdanEmail);

    const olena = await agent
      .post('/api/auth/register')
      .send({ name: 'Олена', email: olenaEmail, password: PASSWORD });
    await agent.post('/api/auth/logout').set('Content-Type', 'application/json');
    await agent.post('/api/auth/login').send({ email: bohdanEmail, password: PASSWORD });
    const me = await agent.get('/api/auth/me');
    const oldSession = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(sessionToken(olena)));

    expect((me.body as AuthUserResponse).user.email).toBe(bohdanEmail);
    expect(oldSession.status).toBe(401);
  });

  it('US-X.1b-AC-03 новий вхід на пристрої без виходу видаляє попередню сесію цього пристрою', async () => {
    const agent = request.agent(app);
    const bohdanEmail = uniqueEmail('bohdan');
    await register(bohdanEmail);

    const olena = await agent
      .post('/api/auth/register')
      .send({ name: 'Олена', email: uniqueEmail('olena'), password: PASSWORD });
    await agent.post('/api/auth/login').send({ email: bohdanEmail, password: PASSWORD });
    const oldToken = sessionToken(olena);

    expect(await prisma.session.count({ where: { tokenHash: hashSessionToken(oldToken) } })).toBe(0);
    expect((await agent.get('/api/auth/me').then((res) => res.body as AuthUserResponse)).user.email).toBe(
      bohdanEmail,
    );
  });
});

describe('Content-Type для запитів зі зміною даних', () => {
  it('перевірка Content-Type іде до визначення маршруту: невідомий шлях без JSON — 400, з JSON — 404', async () => {
    const withoutJson = await request(app).post('/api/does-not-exist').type('form').send({ a: '1' });
    const withJson = await request(app).post('/api/does-not-exist').send({ a: '1' });

    expect(withoutJson.status).toBe(400);
    expect((withoutJson.body as ErrorBody).error.details).toEqual({
      fields: [{ path: 'body', reason: 'invalid_content_type' }],
    });
    expect(withJson.status).toBe(404);
    expect(errorCode(withJson)).toBe('ENDPOINT_NOT_FOUND');
  });

  it('US-1.2-AC-01 реєстрація формою без application/json повертає 400 VALIDATION_ERROR invalid_content_type', async () => {
    const email = uniqueEmail('olena');

    const res = await request(app)
      .post('/api/auth/register')
      .type('form')
      .send({ name: 'Олена', email, password: PASSWORD });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fields: [{ path: 'body', reason: 'invalid_content_type' }] },
    });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('US-X.1b-AC-01 вихід без application/json не видаляє сесію', async () => {
    const token = sessionToken(await register(uniqueEmail('olena')));

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token));

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(await prisma.session.count({ where: { tokenHash: hashSessionToken(token) } })).toBe(1);
  });
});

describe('Наскрізний цикл автентифікації', () => {
  it('US-1.2-AC-01 US-X.1a-AC-01 US-X.1b-AC-01 реєстрація → me → logout → login → me', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail('olena');

    const registered = await agent
      .post('/api/auth/register')
      .send({ name: 'Олена', email, password: PASSWORD });
    const meAfterRegister = await agent.get('/api/auth/me');
    const logout = await agent.post('/api/auth/logout').set('Content-Type', 'application/json');
    const meAfterLogout = await agent.get('/api/auth/me');
    const login = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    const meAfterLogin = await agent.get('/api/auth/me');

    expect(registered.status).toBe(201);
    expect(meAfterRegister.status).toBe(200);
    expect(meAfterRegister.body).toEqual(registered.body);
    expect(logout.status).toBe(204);
    expect(meAfterLogout.status).toBe(401);
    expect(login.status).toBe(200);
    expect(meAfterLogin.body).toEqual(registered.body);
  });
});
