import { useEffect, useEffectEvent } from 'react';
import { Link } from 'react-router';
import type { Booking } from '@roomly/shared';
import { isStartNoticeDue } from '../lib/bookingView';
import { formatRemaining, formatRemainingMinutes, remainingMs, serverNowMs } from '../lib/countdown';
import { formatTime } from '../lib/dateTime';
import { useClientNow } from '../lib/useClientNow';
import styles from './BookingCheckInPrompt.module.css';

interface BookingCheckInPromptProps {
  booking: Booking;
  // serverTime відповіді, з якої взято booking, і клієнтський момент її отримання (TA-5).
  serverTime: string;
  receivedAt: number;
  // Залишок досяг 0: сторінка перепитує бронювання. Статус локально не змінюється.
  onExpire: () => void;
  // На деталях посилання вже є окремо, тут не дублюється.
  showCheckInLink?: boolean;
}

// US-5.3, US-5.4: повідомлення на початку бронювання з дедлайном і відлік до нього. Лише в
// застосунку, без push (US-5.4-AC-03). Дедлайн той самий, що в деталях (US-5.4-AC-02).
export function BookingCheckInPrompt({
  booking,
  serverTime,
  receivedAt,
  onExpire,
  showCheckInLink = true,
}: BookingCheckInPromptProps) {
  const clientNow = useClientNow();
  const serverNow = serverNowMs(serverTime, receivedAt, clientNow);
  const left = remainingMs(booking.deadline, serverTime, clientNow, receivedAt);
  const started = booking.status === 'active' && Date.parse(booking.slot.startsAt) <= serverNow;
  const expired = started && left === 0;
  const due = !expired && isStartNoticeDue(booking, serverNow);

  const handleExpire = useEffectEvent(onExpire);
  useEffect(() => {
    if (expired) handleExpire();
  }, [expired]);

  if (!due && !expired) return null;

  return (
    <section className={styles.prompt} aria-label="Підтвердження присутності">
      {expired ? (
        <p className={styles.expired}>Час підтвердження минув, оновлюємо статус…</p>
      ) : (
        <>
          <p className={styles.title}>
            Підтвердіть присутність до <time dateTime={booking.deadline}>{formatTime(booking.deadline)}</time>
          </p>
          <p className={styles.countdown}>
            Залишилося{' '}
            <span className={styles.timer} role="timer" aria-live="off">
              {formatRemaining(left)}
            </span>
          </p>
          {showCheckInLink && (
            <Link className={styles.link} to="/check-in">
              Підтвердити присутність
            </Link>
          )}
        </>
      )}
      {/* Озвучується лише цей підпис раз на хвилину, а не кожна секунда відліку. */}
      <span className={styles.srOnly} aria-live="polite">
        {expired ? 'Час підтвердження минув, оновлюємо статус' : formatRemainingMinutes(left)}
      </span>
    </section>
  );
}
