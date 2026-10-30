import { Router } from 'express';
import type { HealthResponse } from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { now } from '../../lib/clock';

export const healthRouter = Router();

// Недоступна база не змінює HTTP-статус: ендпоінт показує стан (api_spec.md §4).
healthRouter.get('/', async (_req, res) => {
  let database: HealthResponse['database'] = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error('Health check: database unavailable', err);
    database = 'unavailable';
  }

  const body: HealthResponse = { status: 'ok', database, serverTime: now().toISOString() };
  res.json(body);
});
