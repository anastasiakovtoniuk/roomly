import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErrorBody, HealthResponse } from '@roomly/shared';
import { createApp } from '../src/app';
import { resetClock, setClock } from '../src/lib/clock';

const app = createApp();

afterEach(() => resetClock());

describe('GET /api/health', () => {
  it('повертає 200, стан бази й серверний час', async () => {
    setClock(() => new Date('2026-11-03T12:00:00.000Z'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual<HealthResponse>({
      status: 'ok',
      database: 'ok',
      serverTime: '2026-11-03T12:00:00.000Z',
    });
  });
});

describe('Єдиний формат помилок', () => {
  it('невідомий шлях під /api повертає 404 ENDPOINT_NOT_FOUND', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('нерозбірний JSON повертає 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
  });
});
