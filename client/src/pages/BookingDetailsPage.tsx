import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Booking } from '@roomly/shared';
import { cancelBooking, getBooking } from '../api/bookings';
import { ApiError, NetworkError } from '../api/http';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import { bookingStatusLabel, bookingStatusTone, canCancelBooking } from '../lib/bookingView';
import { formatDate, formatTime } from '../lib/dateTime';
import styles from './Bookings.module.css';

type DetailsState =
  { kind: 'ready'; id: string; booking: Booking } | { kind: 'error'; id: string; error: unknown };

function formatMoment(value: string): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

// US-3.2a, US-3.2b, US-4.3: деталі власного бронювання й скасування. Дедлайн лише показується
// за даними сервера, клієнтський годинник не вирішує, чи можна скасувати.
export function BookingDetailsPage() {
  const { id } = useParams();
  const [state, setState] = useState<DetailsState | null>(null);
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  // Синхронний замок не дає двом клікам надіслати скасування до наступного render.
  const cancelLock = useRef(false);
  const operationVersion = useRef(0);

  useEffect(() => {
    return () => {
      // Відповідь скасування після виходу з екрана не повинна змінити новий маршрут.
      operationVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void getBooking(id, controller.signal).then(
      ({ booking }) => {
        if (controller.signal.aborted) return;
        if (booking.id !== id) {
          setState({
            kind: 'error',
            id,
            error: new NetworkError(new Error('Відповідь не відповідає обраному бронюванню')),
          });
          return;
        }
        setState({ kind: 'ready', id, booking });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', id, error });
      },
    );
    return () => controller.abort();
  }, [id, version]);

  const current = state !== null && state.id === id ? state : null;

  function reload() {
    setState(null);
    setVersion((value) => value + 1);
  }

  async function handleCancel(booking: Booking) {
    if (cancelLock.current || !canCancelBooking(booking.status)) return;
    cancelLock.current = true;
    const operation = operationVersion.current;
    setCancelling(true);
    setActionError(null);
    try {
      const { booking: updated } = await cancelBooking(booking.id);
      if (operation === operationVersion.current) {
        setState({ kind: 'ready', id: updated.id, booking: updated });
        setConfirming(false);
      }
    } catch (error) {
      if (operation !== operationVersion.current) return;
      setActionError(error);
      setConfirming(false);
      // Стан змінився або результат невідомий: показуємо актуальне бронювання з сервера.
      if (
        error instanceof NetworkError ||
        (error instanceof ApiError && error.code === 'BOOKING_STATUS_CONFLICT')
      ) {
        reload();
      }
    } finally {
      cancelLock.current = false;
      if (operation === operationVersion.current) setCancelling(false);
    }
  }

  return (
    <div className={styles.page}>
      {!id ? (
        <ErrorMessage error={new ApiError(404, 'BOOKING_NOT_FOUND', '')} />
      ) : !current ? (
        <>
          {actionError !== null && (
            <div className={styles.actionError}>
              <ErrorMessage error={actionError} />
            </div>
          )}
          <Loader label="Завантажуємо бронювання…" />
        </>
      ) : current.kind === 'error' ? (
        <ErrorMessage error={current.error} onRetry={reload} />
      ) : (
        <article className={styles.details}>
          <div className={styles.cardHead}>
            <h1>{current.booking.room.name}</h1>
            <span className={`${styles.status} ${styles[bookingStatusTone(current.booking.status)]}`}>
              {bookingStatusLabel(current.booking.status)}
            </span>
          </div>
          <p className={styles.meta}>
            {current.booking.room.building} · поверх {current.booking.room.floor}
          </p>

          <dl className={styles.facts}>
            <div>
              <dt>Дата</dt>
              <dd>
                <time dateTime={current.booking.slot.startsAt}>
                  {formatDate(current.booking.slot.startsAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Початок</dt>
              <dd>
                <time dateTime={current.booking.slot.startsAt}>
                  {formatTime(current.booking.slot.startsAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Завершення</dt>
              <dd>
                <time dateTime={current.booking.slot.endsAt}>{formatTime(current.booking.slot.endsAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Дедлайн підтвердження</dt>
              <dd>
                <time dateTime={current.booking.deadline}>{formatMoment(current.booking.deadline)}</time>
              </dd>
            </div>
            {current.booking.cancelledAt && (
              <div>
                <dt>Скасовано</dt>
                <dd>
                  <time dateTime={current.booking.cancelledAt}>
                    {formatMoment(current.booking.cancelledAt)}
                  </time>
                </dd>
              </div>
            )}
          </dl>
          <p className={styles.timezone}>Дата й час за часовим поясом університету.</p>

          {actionError !== null && (
            <div className={styles.actionError}>
              <ErrorMessage error={actionError} />
            </div>
          )}

          {current.booking.status === 'cancelled_by_student' && (
            <p className={styles.notice} role="status">
              Бронювання скасовано, слот знову вільний.{' '}
              <Link to="/bookings?scope=past">Переглянути в історії</Link>
            </p>
          )}

          {canCancelBooking(current.booking.status) &&
            (confirming ? (
              <div className={styles.confirmBox} role="group" aria-label="Підтвердження скасування">
                <p>Скасувати це бронювання? Слот знову стане вільним для інших.</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={cancelling}
                    onClick={() => void handleCancel(current.booking)}
                  >
                    {cancelling ? 'Скасовуємо…' : 'Так, скасувати'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={cancelling}
                    onClick={() => setConfirming(false)}
                  >
                    Залишити
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={styles.secondary}
                disabled={cancelling}
                onClick={() => setConfirming(true)}
              >
                Скасувати бронювання
              </button>
            ))}
        </article>
      )}
      <Link className={styles.back} to="/bookings">
        До моїх бронювань
      </Link>
    </div>
  );
}
