import { afterEach, beforeEach } from 'vitest';
import { resetClock, setClock } from '../../src/lib/clock';

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

// Момент відносно бази зі зсувом у хвилинах: at('2026-11-03T08:00:00.000Z', 15) — дедлайн слота о 10:00 за Києвом.
export function at(base: Date | string, offsetMinutes = 0): Date {
  return new Date(new Date(base).getTime() + offsetMinutes * MINUTE_MS);
}

// Реєструє хуки поточного describe/файла: перед кожним тестом годинник дорівнює `initial`
// (якщо задано), після кожного повертається справжній, щоб тести не впливали один на одного.
export function useClock(initial?: Date): void {
  beforeEach(() => {
    if (initial) setClock(() => initial);
  });
  afterEach(() => {
    resetClock();
  });
}
