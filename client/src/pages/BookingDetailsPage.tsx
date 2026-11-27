import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Booking, BookingResponse } from '@roomly/shared';
import { cancelBooking, getBooking } from '../api/bookings';
import { ApiError, NetworkError } from '../api/http';
import { BookingCheckInPrompt } from '../components/BookingCheckInPrompt';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import { bookingStatusLabel, bookingStatusTone, canCancelBooking } from '../lib/bookingView';
import { formatDate, formatTime } from '../lib/dateTime';
import { usePolling } from '../lib/usePolling';
import styles from './Bookings.module.css';

// serverTime і receivedAt — основа відліку (TA-5); refreshFailed — фонове оновлення не вдалося,
// показуються останні отримані дані.
type DetailsState =
  | {
      kind: 'ready';
      id: string;
      booking: Booking;
      serverTime: string;
      receivedAt: number;
      refreshFailed: boolean;
    }
  | { kind: 'error'; id: string; error: unknown };

function readyState(response: BookingResponse): DetailsState {
  return {
    kind: 'ready',
    id: response.booking.id,
    booking: response.booking,
    serverTime: response.serverTime,
    receivedAt: Date.now(),
    refreshFailed: false,
  };
}

function formatMoment(value: string): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

// US-3.2a, US-3.2b, US-4.3: деталі власного бронювання й скасування. US-5.3, US-5.4: відлік і
// повідомлення на початку бронювання. Дедлайн і статус — лише за даними сервера; клієнтський
// годинник не вирішує, чи можна скасувати, і не змінює статус.
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
  // Застосовується лише відповідь останнього запиту: старе фонове оновлення не перепише
  // результат скасування чи нового завантаження.
  const requestSeq = useRef(0);

  useEffect(() => {
    return () => {
      // Відповідь скасування після виходу з екрана не повинна змінити новий маршрут.
      operationVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    requestSeq.current += 1;
    void getBooking(id, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        if (response.booking.id !== id) {
          setState({
            kind: 'error',
            id,
            error: new NetworkError(new Error('Відповідь не відповідає обраному бронюванню')),
          });
          return;
        }
        setState(readyState(response));
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

  // Фонове оновлення без індикатора завантаження: опитування кожні 30 с і запит після нуля відліку
  // (checkin_admin_flow.md, рішення 5). Під час скасування не виконується.
  async function refresh() {
    if (!id || cancelLock.current || current?.kind !== 'ready') return;
    requestSeq.current += 1;
    const request = requestSeq.current;
    const operation = operationVersion.current;
    const isLatest = () => request === requestSeq.current && operation === operationVersion.current;
    try {
      const response = await getBooking(id);
      if (!isLatest() || response.booking.id !== id) return;
      setState(readyState(response));
    } catch {
      if (!isLatest()) return;
      // Помилку не приховуємо, але й не прибираємо останні дані сервера з екрана.
      setState((previous) =>
        previous?.kind === 'ready' && previous.id === id ? { ...previous, refreshFailed: true } : previous,
      );
    }
  }

  usePolling(() => void refresh());

  async function handleCancel(booking: Booking) {
    if (cancelLock.current || !canCancelBooking(booking.status)) return;
    cancelLock.current = true;
    requestSeq.current += 1;
    const operation = operationVersion.current;
    setCancelling(true);
    setActionError(null);
    try {
      const response = await cancelBooking(booking.id);
      if (operation === operationVersion.current) {
        setState(readyState(response));
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

          {current.booking.status === 'active' && (
            <BookingCheckInPrompt
              booking={current.booking}
              serverTime={current.serverTime}
              receivedAt={current.receivedAt}
              onExpire={() => void refresh()}
              showCheckInLink={false}
            />
          )}

          {current.refreshFailed && (
            <p className={styles.note} role="status">
              Не вдалося оновити статус. Показано останні отримані дані; повторимо за 30 с.
            </p>
          )}

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

          {/* Дві дії одного рівня з відступом (#78): основна — підтвердження, незворотне скасування
              виділено кольором помилки. Чи відкрите вікно підтвердження, вирішує сервер. */}
          {(current.booking.status === 'active' ||
            (canCancelBooking(current.booking.status) && !confirming)) && (
            <div className={styles.detailActions}>
              {current.booking.status === 'active' && (
                <Link className={styles.primaryAction} to="/check-in">
                  Підтвердити присутність
                </Link>
              )}
              {canCancelBooking(current.booking.status) && !confirming && (
                <button
                  type="button"
                  className={styles.dangerOutline}
                  disabled={cancelling}
                  onClick={() => setConfirming(true)}
                >
                  Скасувати бронювання
                </button>
              )}
            </div>
          )}

          {canCancelBooking(current.booking.status) && confirming && (
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
          )}
        </article>
      )}
      <Link className={styles.back} to="/bookings">
        До моїх бронювань
      </Link>
    </div>
  );
}
