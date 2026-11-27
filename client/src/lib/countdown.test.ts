import { describe, expect, it } from 'vitest';
import { formatRemaining, formatRemainingMinutes, remainingMs } from './countdown';

// Відлік до дедлайну (#44) за даними сервера (TA-5). Слот 14:00 за Києвом = 12:00Z, дедлайн 14:15.
const DEADLINE = '2026-11-03T12:15:00.000Z';
const at = (time: string) => `2026-11-03T${time}:00.000Z`;
const MIN = 60_000;

describe('Відлік до дедлайну підтвердження', () => {
  it('US-5.3-AC-03: о 14:05 лишається 10 хв, о 14:10 — 5 хв', () => {
    const t1405 = Date.parse(at('12:05'));
    const t1410 = Date.parse(at('12:10'));
    expect(remainingMs(DEADLINE, at('12:05'), t1405)).toBe(10 * MIN);
    expect(remainingMs(DEADLINE, at('12:10'), t1410)).toBe(5 * MIN);
  });

  it('US-5.3-AC-02: повторне відкриття о 14:10 дає 5 хв від дедлайну, а не повний grace period', () => {
    const reopened = remainingMs(DEADLINE, at('12:10'), Date.parse(at('12:10')));
    expect(reopened).toBe(5 * MIN);
    expect(reopened).not.toBe(15 * MIN);
  });

  it('US-5.3-AC-02: годинник клієнта на 3 хв відстає — результат той самий, рахується від serverTime', () => {
    const clientReceivedAt = Date.parse(at('12:02')); // клієнт думає, що 14:02, а сервер каже 14:05
    expect(remainingMs(DEADLINE, at('12:05'), clientReceivedAt, clientReceivedAt)).toBe(10 * MIN);
    // Минуло 5 хв за клієнтським годинником: на сервері 14:10, лишається 5 хв.
    expect(remainingMs(DEADLINE, at('12:05'), clientReceivedAt + 5 * MIN, clientReceivedAt)).toBe(5 * MIN);
  });

  it('US-5.3-AC-01: після дедлайну залишок 0, а не від’ємний', () => {
    expect(remainingMs(DEADLINE, at('12:20'), Date.parse(at('12:20')))).toBe(0);
  });

  // Формат «хв:с» — робоче рішення #44 (Q13): лише тут фіксується точний рядок, решта тестів
  // порівнює залишок числом або через formatRemaining, тож зміна формату зламає один тест.
  // Тест не закриває Q13: якщо команда обере інший формат, його змінюють разом із рішенням.
  it('Q13 (робоче рішення): залишок показується як «хв:с», підпис для читача — у хвилинах', () => {
    expect(formatRemaining(10 * MIN)).toBe('10:00');
    expect(formatRemaining(10 * MIN - 3_000)).toBe('9:57');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemainingMinutes(5 * MIN)).toContain('5 хв');
  });
});
