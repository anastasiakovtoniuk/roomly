import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { healthRouter } from './modules/health/health.router';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // Модулі за доменом (ADR-0001, ADR-0003): auth, rooms, bookings, check-ins, admin
  // підключаються тут під час реалізації історій.
  app.use('/api/health', healthRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
