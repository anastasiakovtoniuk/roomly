// HTTPS-тунель до клієнта Vite для перевірки на телефоні (issue #57). Камера працює лише в
// захищеному контексті: `https://` або `localhost`; адреса ноутбука в мережі по HTTP не підходить.
//
// `node scripts/dev-tunnel.mjs --check` лише перевіряє налаштування (запускається перед стартом).
// Без прапорця запускає `ngrok http` на порт клієнта зі статичним доменом з `.env`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const NGROK_MISSING =
  'команду `ngrok` не знайдено. Встановіть ngrok і виконайте `ngrok config add-authtoken <токен>` (див. README).';

function fail(message) {
  console.error(`\nТунель не запущено: ${message}\n`);
  process.exit(1);
}

const domain = (process.env.TUNNEL_DOMAIN ?? '').trim();
if (!domain) {
  fail(
    'у .env не задано TUNNEL_DOMAIN. Вкажіть статичний домен ngrok без https:// і без шляху, наприклад ' +
      'TUNNEL_DOMAIN="my-name.ngrok-free.app" (див. README, розділ «Перевірка на телефоні через HTTPS»).',
  );
}
// Лише ім'я хоста: схема, порт чи шлях зламали б allowedHosts у Vite й аргумент ngrok.
if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(domain) || !domain.includes('.')) {
  fail(`TUNNEL_DOMAIN="${domain}" не схожий на ім'я хоста. Потрібен лише домен, без https:// і без шляху.`);
}

if (process.argv.includes('--check')) {
  // Перевіряємо ngrok до старту серверів: інакше помилка з'явилась би лише всередині concurrently,
  // коли сервер і клієнт уже запущені.
  if (spawnSync('ngrok', ['version'], { stdio: 'ignore' }).error?.code === 'ENOENT') fail(NGROK_MISSING);
  console.log(`Тунель: https://${domain} → http://localhost:${process.env.CLIENT_PORT ?? '5173'}`);
  process.exit(0);
}

const port = process.env.CLIENT_PORT ?? '5173';
// Токен ngrok береться з локальної конфігурації ngrok (`ngrok config add-authtoken …`), не з репозиторію.
const child = spawn('ngrok', ['http', port, '--url', `https://${domain}`], {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') fail(NGROK_MISSING);
  fail(err.message);
});
child.on('exit', (code) => process.exit(code ?? 0));

// Якщо `concurrently -k` чи Ctrl+C зупиняє обгортку, ngrok не повинен лишитися працювати: інакше він
// займе статичний домен, і наступний запуск тунелю впаде з помилкою про активну сесію.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
process.on('exit', () => child.kill());
