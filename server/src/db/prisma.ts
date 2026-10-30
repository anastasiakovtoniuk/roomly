import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { databaseUrl } from '../config/env';

// Один клієнт на процес; SQLite серіалізує записи, тож пул з'єднань не потрібен (ADR-0004).
export const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
});
