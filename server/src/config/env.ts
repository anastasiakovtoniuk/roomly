import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Один .env у корені репозиторію для клієнта й сервера (ADR-0007). Уже задані змінні не перезаписуються.
config({ path: path.resolve(serverDir, '../.env'), quiet: true });

// Відносний шлях SQLite рахується від server/, а не від поточної папки, щоб міграції,
// сервер і тести відкривали той самий файл незалежно від того, звідки їх запущено.
function resolveDatabaseUrl(raw: string): string {
  const filePath = raw.replace(/^file:/, '');
  return `file:${path.resolve(serverDir, filePath)}`;
}

export const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL ?? 'file:./prisma/dev.db');

export const serverPort = Number(process.env.SERVER_PORT ?? 3000);

// Часовий пояс університету (G9, Europe/Kyiv — [Гіпотеза]): у ньому рахується «дата» слота.
// Порожнє значення означає типовий пояс, як і відсутня змінна. Невідома зона зупиняє запуск одразу, а не дає хибні дати в кожній відповіді.
function resolveTimeZone(raw: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Некоректний APP_TIMEZONE: ${raw}`);
  }
}

export const appTimezone = resolveTimeZone(process.env.APP_TIMEZONE || 'Europe/Kyiv');
