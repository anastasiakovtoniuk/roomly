import { defineConfig } from 'vitest/config';

// Змінна задається до завантаження src/config/env.ts, тому dotenv її не перезапише.
process.env.DATABASE_URL = 'file:./prisma/test.db';
// Межі доби в тестах розраховані на цей пояс; значення з .env розробника їх не змінює.
process.env.APP_TIMEZONE = 'Europe/Kyiv';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
  },
});
