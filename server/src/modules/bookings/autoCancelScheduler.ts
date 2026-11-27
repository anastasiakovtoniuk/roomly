import { cancelExpiredBookings } from './autoCancel';

// Q16 [Рішення команди, checkin_admin_flow.md, рішення 9]: інтервал 30 с (ADR-0006, TA-6: не більше хвилини).
const DEFAULT_INTERVAL_MS = 30_000;

// Фоновий таймер у процесі сервера: статуси в БД не застарівають, поки ніхто нічого не читає.
// Не запускається з createApp(), щоб у тестах не було таймерів; стартує лише з index.ts.
// `run` можна підмінити (тест помилки ітерації); за замовчуванням — спільна функція скасування.
export function startAutoCancelScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  run: () => Promise<number> = cancelExpiredBookings,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    // Попередня ітерація ще триває: не накопичуємо паралельні виклики.
    if (running) return;
    running = true;
    run()
      .catch((err: unknown) => {
        // Помилка однієї ітерації не повинна зупиняти планувальник чи валити сервер.
        console.error('Автоскасування: помилка ітерації', err);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Таймер не тримає процес живим під час зупинки сервера.
  timer.unref();
  return () => clearInterval(timer);
}
