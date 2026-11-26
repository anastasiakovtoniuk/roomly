import { useCallback, useEffect, useState } from 'react';

type FocusRequest = { target: () => HTMLElement | null };

// Фокус ставиться після render, коли поле з помилкою чи новий рядок уже в DOM. Новий об'єкт на
// кожен запит: повторна помилка в тому самому полі теж повертає фокус.
export function useFocusRequest(): (target: () => HTMLElement | null) => void {
  const [request, setRequest] = useState<FocusRequest | null>(null);
  useEffect(() => {
    request?.target()?.focus();
  }, [request]);
  return useCallback((target: () => HTMLElement | null) => setRequest({ target }), []);
}
