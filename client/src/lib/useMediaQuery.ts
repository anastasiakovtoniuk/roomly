import { useSyncExternalStore } from 'react';

// Підписка на CSS media query: компонент перебудовується, коли вікно перетинає межу.
// Потрібна там, де від ширини залежить місце в DOM (а не лише вигляд), тому самих стилів мало.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
