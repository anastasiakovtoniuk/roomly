import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AvailableSlotsQuery, RegisterBody, RoomIdParams, type ErrorBody } from '@roomly/shared';
import { errorHandler } from '../src/middleware/errorHandler';
import { validate } from '../src/middleware/validate';

const ROOM_ID = '8f1a0c2e-1111-4222-8333-444455556666';

// Тестові маршрути повертають те, що отримав обробник після validate.
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/register', validate({ body: RegisterBody }), (req, res) => {
    res.json({ body: req.body as unknown });
  });
  app.get(
    '/api/rooms/:roomId/available-slots',
    validate({ params: RoomIdParams, query: AvailableSlotsQuery }),
    (req, res) => {
      res.json({ params: req.params, query: req.query });
    },
  );
  app.use(errorHandler);
  return app;
}

const app = createTestApp();

describe('validate', () => {
  it('US-1.2-AC-01 передає обробнику нормалізоване тіло без зайвих полів', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: ' Олена ', email: ' Olena@Example.com', password: 'secret-pass', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      body: { name: 'Олена', email: 'olena@example.com', password: 'secret-pass' },
    });
  });

  it('US-1.2-AC-01 повертає 400 VALIDATION_ERROR з усіма полями тіла за error_format.md', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: 'Олена', email: 'olena', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual<ErrorBody>({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некоректні дані запиту',
        details: {
          fields: [
            { path: 'email', reason: 'invalid_format' },
            { path: 'password', reason: 'too_small' },
          ],
        },
      },
    });
  });

  it('US-1.2-AC-01 запит без тіла повертає 400 VALIDATION_ERROR з path body', async () => {
    const res = await request(app).post('/api/register');

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toEqual({
      fields: [{ path: 'body', reason: 'invalid_type' }],
    });
  });

  it('US-2.4-AC-01 збирає помилки параметрів шляху й запиту з префіксами params і query', async () => {
    const res = await request(app).get('/api/rooms/R101/available-slots?date=2026-02-30');

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        fields: [
          { path: 'params.roomId', reason: 'invalid_format' },
          { path: 'query.date', reason: 'invalid_format' },
        ],
      },
    });
  });

  it('US-2.4-AC-01 відсутній параметр запиту має path query.date', async () => {
    const res = await request(app).get(`/api/rooms/${ROOM_ID}/available-slots`);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toEqual({
      fields: [{ path: 'query.date', reason: 'invalid_type' }],
    });
  });

  it('US-2.4-AC-01 пропускає валідний запит і замінює query розібраним значенням', async () => {
    const res = await request(app).get(`/api/rooms/${ROOM_ID}/available-slots?date=2026-11-03&extra=1`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { roomId: ROOM_ID }, query: { date: '2026-11-03' } });
  });
});
