import { defineConfig } from 'vitest/config';

// Змінна задається до завантаження src/config/env.ts, тому dotenv її не перезапише.
process.env.DATABASE_URL = 'file:./prisma/test.db';
// Межі доби в тестах розраховані на цей пояс; значення з .env розробника їх не змінює.
process.env.APP_TIMEZONE = 'Europe/Kyiv';

export default defineConfig({
  test: {
    environment: 'node',
    // Тестова база спільна, а ліниве автоскасування (ADR-0006) глобальне: запит із підміненим годинником
    // скасовує прострочені `active` усіх користувачів. Паралельні файли псували б чужі бронювання,
    // тому файли виконуються по черзі; тести всередині файла й так послідовні.
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
  },
});
