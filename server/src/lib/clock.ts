// Єдине джерело поточного моменту для сервісів (ADR-0003, ADR-0006).
// Тести підміняють його через setClock, а не чекають реального часу (ADR-0008).

export type Clock = () => Date;

let current: Clock = () => new Date();

export function now(): Date {
  return current();
}

export function setClock(clock: Clock): void {
  current = clock;
}

export function resetClock(): void {
  current = () => new Date();
}
