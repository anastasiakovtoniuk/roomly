import { useEffect, useRef, useState } from 'react';
import type { AdminBooking } from '@roomly/shared';
import { confirmBooking, listAdminBookings } from '../api/adminBookings';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import {
  canConfirmManually,
  confirmedByLabel,
  manualConfirmFailure,
  manualConfirmSuccess,
  type ManualConfirmOutcome,
} from '../lib/adminBookings';
import { bookingStatusLabel, bookingStatusTone } from '../lib/bookingView';
import { formatDate, formatTime } from '../lib/dateTime';
import bookingStyles from './Bookings.module.css';
import styles from './AdminBookingsPage.module.css';

type ListState =
  { kind: 'loading' } | { kind: 'ready'; bookings: AdminBooking[] } | { kind: 'error'; error: unknown };

// /admin/bookings: усі бронювання зі статусами (US-A.5) і ручне підтвердження (US-A.7).
// Чи відкрите вікно, вирішує сервер; після будь-якої відповіді список перечитується з сервера.
export function AdminBookingsPage() {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [version, setVersion] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ bookingId: string; result: ManualConfirmOutcome } | null>(null);
  // Синхронний замок: другий запит підтвердження не надсилається, поки триває перший.
  const confirmLock = useRef(false);
  const pageVersion = useRef(0);

  useEffect(() => {
    return () => {
      pageVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void listAdminBookings(controller.signal).then(
      ({ bookings }) => {
        if (!controller.signal.aborted) setList({ kind: 'ready', bookings });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setList({ kind: 'error', error });
      },
    );
    return () => controller.abort();
  }, [version]);

  // Попередній список лишається на екрані під час оновлення, щоб картки не стрибали.
  function refresh() {
    setVersion((value) => value + 1);
  }

  async function handleConfirm(booking: AdminBooking) {
    if (confirmLock.current || !canConfirmManually(booking.status)) return;
    confirmLock.current = true;
    const page = pageVersion.current;
    setConfirmingId(booking.id);
    setOutcome(null);
    let result: ManualConfirmOutcome;
    try {
      result = manualConfirmSuccess(await confirmBooking(booking.id));
    } catch (error) {
      result = manualConfirmFailure(error);
    } finally {
      confirmLock.current = false;
    }
    if (page !== pageVersion.current) return;
    setConfirmingId(null);
    setOutcome({ bookingId: booking.id, result });
    if (result.refresh) refresh();
  }

  return (
    <div className={styles.page}>
      <header className={bookingStyles.heading}>
        <p className={bookingStyles.eyebrow}>Адміністрування</p>
        <h1>Усі бронювання</h1>
        <p className={bookingStyles.intro}>
          Бронювання всіх студентів, нові зверху. Активне бронювання можна підтвердити вручну до дедлайну.
        </p>
      </header>

      {list.kind === 'loading' && <Loader label="Завантажуємо бронювання…" />}
      {list.kind === 'error' && (
        <ErrorMessage
          error={list.error}
          onRetry={() => {
            setList({ kind: 'loading' });
            refresh();
          }}
        />
      )}
      {list.kind === 'ready' && list.bookings.length === 0 && (
        <EmptyState title="Бронювань поки немає" description="Тут з'являться бронювання студентів." />
      )}
      {list.kind === 'ready' && list.bookings.length > 0 && (
        <ul className={bookingStyles.list}>
          {list.bookings.map((booking) => {
            const byLabel = booking.status === 'confirmed' ? confirmedByLabel(booking.confirmedBy) : null;
            const bookingOutcome = outcome?.bookingId === booking.id ? outcome.result : null;
            return (
              <li key={booking.id} className={bookingStyles.card}>
                <div className={bookingStyles.cardHead}>
                  <h2 className={styles.room}>{booking.room.name}</h2>
                  <span
                    className={`${bookingStyles.status} ${bookingStyles[bookingStatusTone(booking.status)]}`}
                  >
                    {bookingStatusLabel(booking.status)}
                    {byLabel && ` · ${byLabel}`}
                  </span>
                </div>
                <p className={bookingStyles.meta}>
                  {booking.room.building} · поверх {booking.room.floor}
                </p>
                <p className={bookingStyles.when}>
                  <time dateTime={booking.slot.startsAt}>{formatDate(booking.slot.startsAt)}</time>,{' '}
                  <time dateTime={booking.slot.startsAt}>{formatTime(booking.slot.startsAt)}</time>–
                  <time dateTime={booking.slot.endsAt}>{formatTime(booking.slot.endsAt)}</time>
                </p>
                <p className={styles.student}>
                  <span>{booking.student.name}</span>
                  <span className={styles.email}>{booking.student.email}</span>
                </p>

                {bookingOutcome && (
                  <p
                    className={bookingOutcome.tone === 'ok' ? styles.ok : styles.error}
                    role={bookingOutcome.tone === 'ok' ? 'status' : 'alert'}
                  >
                    {bookingOutcome.message}
                  </p>
                )}

                {canConfirmManually(booking.status) && (
                  <button
                    type="button"
                    className={styles.confirm}
                    disabled={confirmingId !== null}
                    onClick={() => void handleConfirm(booking)}
                  >
                    {confirmingId === booking.id ? 'Підтверджуємо…' : 'Підтвердити вручну'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
