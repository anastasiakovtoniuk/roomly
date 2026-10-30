// Створює .env з .env.example, якщо .env ще немає. Наявний .env не перезаписується (ADR-0007).
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');

if (existsSync(envFile)) {
  console.log('.env вже існує — використовуємо його.');
} else {
  copyFileSync(path.join(root, '.env.example'), envFile);
  console.log('Створено .env з .env.example.');
}
