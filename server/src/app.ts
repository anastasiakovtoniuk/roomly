import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireJson } from './middleware/requireJson';
import { authRouter } from './modules/auth/auth.router';
import { healthRouter } from './modules/health/health.router';
import { roomsRouter } from './modules/rooms/rooms.router';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api', requireJson);

  // Модулі за доменом (ADR-0001, ADR-0003): rooms, bookings, check-ins, admin
  // підключаються тут під час реалізації історій.
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/rooms', roomsRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
