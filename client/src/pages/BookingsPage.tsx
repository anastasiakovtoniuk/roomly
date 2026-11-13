import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BOOKING_SCOPES, type Booking, type BookingScope } from '@roomly/shared';
import { listMyBookings } from '../api/bookings';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import { bookingStatusLabel, bookingStatusTone, parseBookingScope } from '../lib/bookingView';
import { formatDate, formatTime } from '../lib/dateTime';
import styles from './Bookings.module.css';

const SCOPE_TITLES: Readonly<Record<BookingScope, string>> = { upcoming: 'Майбутні', past: 'Минулі' };

type ListState =
  | { kind: 'ready'; scope: BookingScope; bookings: Booking[] }
  | { kind: 'error'; scope: BookingScope; error: unknown };

// US-4.2, US-X.3: лише власні бронювання; поділ на вкладки робить сервер (Q12 — рішення команди).
export function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const scope = parseBookingScope(params.get('scope'));
  const [state, setState] = useState<ListState | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listMyBookings({ scope }, controller.signal).then(
      ({ bookings }) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', scope, bookings });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', scope, error });
      },
    );
    return () => controller.abort();
  }, [scope, version]);

  // Результат іншої вкладки не належить поточній, навіть до cleanup ефекту.
  const current = state !== null && state.scope === scope ? state : null;

  function selectScope(next: BookingScope) {
    if (next === scope) return;
    setParams(next === 'upcoming' ? {} : { scope: next });
  }

  function reload() {
    setState(null);
    setVersion((value) => value + 1);
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Твої зустрічі</p>
        <h1>Мої бронювання</h1>
        <p className={styles.intro}>Тут усі твої бронювання: майбутні й історія.</p>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Мої бронювання">
        {BOOKING_SCOPES.map((item) => (
          <button
            key={item}
            id={`bookings-tab-${item}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={item === scope}
            aria-controls="bookings-panel"
            onClick={() => selectScope(item)}
          >
            {SCOPE_TITLES[item]}
          </button>
        ))}
      </div>

      <section id="bookings-panel" role="tabpanel" aria-labelledby={`bookings-tab-${scope}`}>
        {scope === 'past' && (
          <p className={styles.note}>
            В історії лише скасовані бронювання та ті, слот яких уже почався або завершився.
          </p>
        )}
        {!current ? (
          <Loader label="Завантажуємо бронювання…" />
        ) : current.kind === 'error' ? (
          <ErrorMessage error={current.error} onRetry={reload} />
        ) : current.bookings.length === 0 ? (
          scope === 'upcoming' ? (
            <EmptyState title="Майбутніх бронювань немає" description="Обери кімнату й вільний час.">
              <Link to="/rooms">До кімнат</Link>
            </EmptyState>
          ) : (
            <EmptyState
              title="Історія порожня"
              description="Тут з’являться скасовані та минулі бронювання."
            />
          )
        ) : (
          <ul className={styles.list} aria-label={SCOPE_TITLES[scope]}>
            {current.bookings.map((booking) => (
              <li key={booking.id}>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h3>{booking.room.name}</h3>
                    <span className={`${styles.status} ${styles[bookingStatusTone(booking.status)]}`}>
                      {bookingStatusLabel(booking.status)}
                    </span>
                  </div>
                  <p className={styles.meta}>
                    {booking.room.building} · поверх {booking.room.floor}
                  </p>
                  <p className={styles.when}>
                    <time dateTime={booking.slot.startsAt}>{formatDate(booking.slot.startsAt)}</time>
                    {', '}
                    <time dateTime={booking.slot.startsAt}>{formatTime(booking.slot.startsAt)}</time>
                    {' — '}
                    <time dateTime={booking.slot.endsAt}>{formatTime(booking.slot.endsAt)}</time>
                  </p>
                  <Link className={styles.detailsLink} to={`/bookings/${encodeURIComponent(booking.id)}`}>
                    Деталі
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
