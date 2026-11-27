import { defineConfig } from 'vitest/config';

// Тести клієнта лежать поряд із модулями (`src/**/*.test.ts(x)`). За замовчуванням середовище `node`:
// чиста логіка (API-функції, дата й час, помилки форм, відлік) не потребує DOM. Файл, якому потрібен
// браузер, вмикає jsdom сам рядком `// @vitest-environment jsdom` на початку.
export default defineConfig({
  // Як у vite.config.ts: пояс університету — константа збірки; у тестах фіксований, щоб результат
  // не залежав від .env розробника.
  define: { __APP_TIMEZONE__: JSON.stringify('Europe/Kyiv') },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
