import { useSyncExternalStore } from 'react';

// Спільний секундний «тік» клієнтського годинника для відліку (US-5.3). Один інтервал на всі
// підписані компоненти; зупиняється, коли підписників немає. Годинник лише відміряє час від
// отримання serverTime (countdown.ts) і не є підставою змінювати статус.
const TICK_MS = 1000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const listener of listeners) listener();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

// Без підписників значення округлюється до секунди: React кілька разів читає знімок до підписки,
// і він має лишатися стабільним, а не змінюватися з кожним викликом.
function getSnapshot(): number {
  return timer === undefined ? Math.floor(Date.now() / TICK_MS) * TICK_MS : now;
}

export function useClientNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
