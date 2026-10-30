import { defineConfig } from 'vitest/config';

// Змінна задається до завантаження src/config/env.ts, тому dotenv її не перезапише.
process.env.DATABASE_URL = 'file:./prisma/test.db';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
  },
});
