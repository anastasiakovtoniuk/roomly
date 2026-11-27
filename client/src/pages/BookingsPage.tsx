import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Booking, BookingListResponse } from '@roomly/shared';
import { listMyBookings } from '../api/bookings';
import { BookingCheckInPrompt } from '../components/BookingCheckInPrompt';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import {
  BOOKING_TABS,
  type BookingTab,
  bookingStatusLabel,
  bookingStatusTone,
  bookingTabScope,
  isReminderDue,
  parseBookingTab,
  splitStartedBookings,
} from '../lib/bookingView';
import { formatDate, formatTime } from '../lib/dateTime';
import { usePolling } from '../lib/usePolling';
import styles from './Bookings.module.css';

const TAB_TITLES: Readonly<Record<BookingTab, string>> = {
  upcoming: 'Майбутні',
  ongoing: 'Активні',
  past: 'Минулі',
};

// serverTime і receivedAt — основа поділу на вкладки й відліку (TA-5); refreshFailed — фонове
// оновлення не вдалося, показуються останні отримані дані.
type ListState =
  | {
      kind: 'ready';
      tab: BookingTab;
      bookings: Booking[];
      serverTime: string;
      receivedAt: number;
      refreshFailed: boolean;
    }
  | { kind: 'error'; tab: BookingTab; error: unknown };

// «Активні» й «Минулі» — клієнтський поділ відповіді scope=past за serverTime (рішення 5
// checkin_admin_flow.md); «Майбутні» — scope=upcoming без змін.
function readyState(tab: BookingTab, response: BookingListResponse): ListState {
  const bookings =
    tab === 'upcoming'
      ? response.bookings
      : splitStartedBookings(response.bookings, response.serverTime)[tab];
  return {
    kind: 'ready',
    tab,
    bookings,
    serverTime: response.serverTime,
    receivedAt: Date.now(),
    refreshFailed: false,
  };
}

// US-4.2, US-X.3, US-4.1, US-5.3, US-5.4: лише власні бронювання; поділ upcoming/past робить сервер
// (Q12), а бронювання, що триває, клієнт виносить у «Активні». Статус оновлюється опитуванням.
export function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = parseBookingTab(params.get('scope'));
  const [state, setState] = useState<ListState | null>(null);
  const [version, setVersion] = useState(0);
  // Застосовується лише відповідь останнього запиту; фонове оновлення не перепише нову вкладку.
  const requestSeq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    requestSeq.current += 1;
    void listMyBookings({ scope: bookingTabScope(tab) }, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) setState(readyState(tab, response));
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', tab, error });
      },
    );
    return () => {
      controller.abort();
      // Відповідь фонового запиту попередньої вкладки чи сторінки вже не потрібна.
      requestSeq.current += 1;
    };
  }, [tab, version]);

  // Результат іншої вкладки не належить поточній, навіть до cleanup ефекту.
  const current = state !== null && state.tab === tab ? state : null;

  async function refresh() {
    if (current?.kind !== 'ready') return;
    requestSeq.current += 1;
    const request = requestSeq.current;
    try {
      const response = await listMyBookings({ scope: bookingTabScope(tab) });
      if (request === requestSeq.current) setState(readyState(tab, response));
    } catch {
      if (request !== requestSeq.current) return;
      setState((previous) =>
        previous?.kind === 'ready' && previous.tab === tab ? { ...previous, refreshFailed: true } : previous,
      );
    }
  }

  usePolling(() => void refresh());

  function selectTab(next: BookingTab) {
    if (next === tab) return;
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
        <p className={styles.intro}>Тут усі твої бронювання: майбутні, активні зараз та історія.</p>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Мої бронювання">
        {BOOKING_TABS.map((item) => (
          <button
            key={item}
            id={`bookings-tab-${item}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={item === tab}
            aria-controls="bookings-panel"
            onClick={() => selectTab(item)}
          >
            {TAB_TITLES[item]}
          </button>
        ))}
      </div>

      <section id="bookings-panel" role="tabpanel" aria-labelledby={`bookings-tab-${tab}`}>
        {tab === 'ongoing' && (
          <p className={styles.note}>Бронювання, слот яких уже почався й ще не завершився.</p>
        )}
        {tab === 'past' && (
          <p className={styles.note}>
            В історії скасовані, автоскасовані й завершені бронювання. Ті, що тривають, — в «Активних».
          </p>
        )}
        {current?.kind === 'ready' && current.refreshFailed && (
          <p className={styles.note} role="status">
            Не вдалося оновити статус. Показано останні отримані дані; повторимо за 30 с.
          </p>
        )}
        {!current ? (
          <Loader label="Завантажуємо бронювання…" />
        ) : current.kind === 'error' ? (
          <ErrorMessage error={current.error} onRetry={reload} />
        ) : current.bookings.length === 0 ? (
          tab === 'upcoming' ? (
            <EmptyState title="Майбутніх бронювань немає" description="Обери кімнату й вільний час.">
              <Link to="/rooms">До кімнат</Link>
            </EmptyState>
          ) : tab === 'ongoing' ? (
            <EmptyState
              title="Зараз активних бронювань немає"
              description="Тут з’явиться бронювання, коли почнеться його слот."
            />
          ) : (
            <EmptyState
              title="Історія порожня"
              description="Тут з’являться скасовані та минулі бронювання."
            />
          )
        ) : (
          <ul className={styles.list} aria-label={TAB_TITLES[tab]}>
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
                  {/* US-4.1 за гіпотезою H02: лише в застосунку, без push; межа 24 год — Q05/G10. */}
                  {tab === 'upcoming' && isReminderDue(booking, current.serverTime) && (
                    <p className={styles.reminder}>
                      Нагадування: бронювання починається{' '}
                      <time dateTime={booking.slot.startsAt}>
                        {formatDate(booking.slot.startsAt)} о {formatTime(booking.slot.startsAt)}
                      </time>
                      . Після початку підтвердь присутність за QR кімнати.
                    </p>
                  )}
                  {tab === 'ongoing' && booking.status === 'active' && (
                    <BookingCheckInPrompt
                      booking={booking}
                      serverTime={current.serverTime}
                      receivedAt={current.receivedAt}
                      onExpire={() => void refresh()}
                    />
                  )}
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
