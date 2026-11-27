import { useEffect, useEffectEvent } from 'react';

// Опитування сервера, поки сторінка відкрита (checkin_admin_flow.md, рішення 5): статус бронювання
// змінює лише сервер, клієнт перепитує його. Прихована вкладка браузера не опитує; після повернення
// дані оновлюються одразу. Зупиняється при виході зі сторінки.
export const BOOKING_POLL_INTERVAL_MS = 30_000;

export function usePolling(callback: () => void, intervalMs: number = BOOKING_POLL_INTERVAL_MS): void {
  const onTick = useEffectEvent(callback);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') onTick();
    }, intervalMs);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') onTick();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs]);
}
