import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { databaseUrl } from './src/config/env';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: databaseUrl,
  },
});
