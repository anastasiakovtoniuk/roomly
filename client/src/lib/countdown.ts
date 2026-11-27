// US-5.3: відлік до дедлайну підтвердження за серверним часом (TA-5, api_spec.md §1).
// Клієнтський годинник лише відміряє, скільки минуло від отримання відповіді; статус він не змінює.

// Оцінка поточного серверного часу: serverTime відповіді плюс час, що минув на клієнті від її
// отримання (зміщення serverTime − Date.now() у момент відповіді).
export function serverNowMs(serverTime: string, receivedAt: number, clientNow: number): number {
  return Date.parse(serverTime) + (clientNow - receivedAt);
}

// Залишок до дедлайну, не менше 0. receivedAt — клієнтський момент отримання serverTime; без нього
// залишок рахується на момент відповіді сервера. Єдина опора — deadline із сервера, тому повторне
// відкриття не перезапускає grace period (US-5.3-AC-02). Некоректна дата дає 0: клієнт тоді лише
// перепитує сервер, а не вигадує залишок.
export function remainingMs(
  deadline: string,
  serverTime: string,
  clientNow: number,
  receivedAt: number = clientNow,
): number {
  const value = Date.parse(deadline) - serverNowMs(serverTime, receivedAt, clientNow);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// «хв:с». Секунди округлюються вгору, тож «0:00» з'являється лише тоді, коли залишок досяг 0.
// Формат і точність відліку — робочі (Q13).
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Підпис для екранного читача: змінюється раз на хвилину, щоб не озвучувати кожну секунду.
export function formatRemainingMinutes(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  return `До дедлайну підтвердження лишилося ${minutes} хв`;
}
