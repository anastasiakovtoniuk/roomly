import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AvailableSlot, AvailableSlotListResponse, ErrorCode, Room } from '@roomly/shared';
import { createBooking } from '../api/bookings';
import { ApiError, NetworkError } from '../api/http';
import { listAvailableSlots, listRooms } from '../api/rooms';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import { formatDate, formatTime, universityDate } from '../lib/dateTime';
import { useMediaQuery } from '../lib/useMediaQuery';
import styles from './RoomsPage.module.css';

const SLOT_REFRESH_ERROR_CODES: readonly ErrorCode[] = [
  'SLOT_ALREADY_BOOKED',
  'SLOT_NOT_BOOKABLE',
  'SLOT_NOT_FOUND',
];

// Межа, з якої каталог показує кімнати й вільний час у двох колонках (збігається з RoomsPage.module.css).
const WIDE_LAYOUT_QUERY = '(min-width: 58rem)';

type RoomsState = { kind: 'loading' } | { kind: 'ready'; rooms: Room[] } | { kind: 'error'; error: unknown };

type SlotsState =
  | { kind: 'ready'; roomId: string; date: string; data: AvailableSlotListResponse }
  | { kind: 'error'; roomId: string; date: string; error: unknown };

export function RoomsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [roomsState, setRoomsState] = useState<RoomsState>({ kind: 'loading' });
  const [roomId, setRoomId] = useState<string | null>(null);
  const [date, setDate] = useState(universityDate);
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [slotsState, setSlotsState] = useState<SlotsState | null>(null);
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<unknown>(null);
  const [uncertainSlotIds, setUncertainSlotIds] = useState<ReadonlySet<string>>(() => new Set());
  // Синхронний замок не дає двом клікам надіслати POST до наступного render.
  const bookingLock = useRef(false);
  const operationVersion = useRef(0);

  useEffect(() => {
    return () => {
      // Відповідь POST після виходу з екрана не повинна змінити новий маршрут.
      operationVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void listRooms(controller.signal).then(
      ({ rooms }) => {
        if (controller.signal.aborted) return;
        setRoomsState({ kind: 'ready', rooms });
        setRoomId((current) =>
          rooms.some((room) => room.id === current) ? current : (rooms[0]?.id ?? null),
        );
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setRoomsState({ kind: 'error', error });
      },
    );
    return () => controller.abort();
  }, [roomsVersion]);

  const selectedRoom =
    roomsState.kind === 'ready' ? roomsState.rooms.find((room) => room.id === roomId) : undefined;
  const selectedRoomId = selectedRoom?.id;

  useEffect(() => {
    if (!selectedRoomId || !date) return;
    const controller = new AbortController();
    void listAvailableSlots(selectedRoomId, { date }, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        if (data.roomId !== selectedRoomId || data.date !== date) {
          setSlotsState({
            kind: 'error',
            roomId: selectedRoomId,
            date,
            error: new NetworkError(new Error('Відповідь не відповідає обраній кімнаті й даті')),
          });
          return;
        }
        setSlotsState({ kind: 'ready', roomId: selectedRoomId, date, data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSlotsState({ kind: 'error', roomId: selectedRoomId, date, error });
      },
    );
    return () => controller.abort();
  }, [selectedRoomId, date, slotsVersion]);

  // Навіть до cleanup ефекту попередній результат не належить новій парі room/date.
  const currentSlots =
    slotsState !== null && slotsState.roomId === selectedRoomId && slotsState.date === date
      ? slotsState
      : null;
  const isBooking = bookingSlotId !== null;
  const canBook = user?.role === 'student';

  // На вузькому екрані вільний час відкривається під обраною кімнатою, а панель попередньої кімнати
  // зникає: без прокручування обрана картка могла б зсунутись за межі екрана.
  const scrollToRoom = useRef(false);
  useEffect(() => {
    if (!scrollToRoom.current) return;
    // Прапорець скидається завжди: вибір на широкому екрані не повинен прокрутити сторінку пізніше,
    // коли вікно звузиться.
    scrollToRoom.current = false;
    if (isWide || !roomId) return;
    document.getElementById(`room-${roomId}`)?.scrollIntoView({ block: 'start' });
  }, [roomId, isWide]);

  function selectRoom(nextRoomId: string) {
    if (bookingLock.current || nextRoomId === roomId) return;
    scrollToRoom.current = true;
    setRoomId(nextRoomId);
    setSlotsState(null);
    setBookingError(null);
  }

  function selectDate(nextDate: string) {
    if (bookingLock.current || nextDate === date) return;
    setDate(nextDate);
    setSlotsState(null);
    setBookingError(null);
  }

  function refreshSlots() {
    if (bookingLock.current) return;
    setSlotsState(null);
    setSlotsVersion((version) => version + 1);
  }

  async function handleBooking(slot: AvailableSlot) {
    if (
      bookingLock.current ||
      !canBook ||
      uncertainSlotIds.has(slot.id) ||
      currentSlots?.kind !== 'ready' ||
      slot.roomId !== selectedRoomId ||
      !currentSlots.data.slots.some((available) => available.id === slot.id)
    )
      return;

    bookingLock.current = true;
    const version = operationVersion.current;
    setBookingSlotId(slot.id);
    setBookingError(null);
    try {
      const { booking } = await createBooking({ slotId: slot.id });
      if (version === operationVersion.current) {
        navigate(`/bookings/${encodeURIComponent(booking.id)}`);
      }
    } catch (error) {
      if (version !== operationVersion.current) return;
      setBookingError(error);
      if (error instanceof NetworkError) {
        // Результат POST невідомий: повтор блокується, пропонуємо перевірити власні записи.
        setUncertainSlotIds((current) => new Set(current).add(slot.id));
      } else if (error instanceof ApiError && SLOT_REFRESH_ERROR_CODES.includes(error.code)) {
        setSlotsState(null);
        setSlotsVersion((current) => current + 1);
      }
    } finally {
      bookingLock.current = false;
      if (version === operationVersion.current) setBookingSlotId(null);
    }
  }

  const availability = (
    <section
      id="room-slots"
      className={`${styles.availability} ${isWide ? '' : styles.inline}`}
      aria-labelledby="slots-title"
      aria-busy={isBooking}
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Вільний час</p>
          <h2 id="slots-title">{selectedRoom?.name ?? 'Обери кімнату'}</h2>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={refreshSlots}
          disabled={isBooking || !selectedRoom}
        >
          Оновити
        </button>
      </div>
      <label className={styles.dateLabel} htmlFor="booking-date">
        Дата зустрічі
      </label>
      <input
        id="booking-date"
        className={styles.dateInput}
        type="date"
        value={date}
        min={universityDate()}
        disabled={isBooking || !selectedRoom}
        onChange={(event) => selectDate(event.target.value)}
      />
      <p className={styles.timezone}>Дата й час за часовим поясом університету.</p>

      {!canBook && <p className={styles.notice}>Бронювання доступне зі студентського акаунта.</p>}
      {bookingError !== null && (
        <div className={styles.bookingError}>
          <ErrorMessage error={bookingError} />
        </div>
      )}
      {uncertainSlotIds.size > 0 && (
        <p className={styles.notice} role="status">
          Результат попереднього бронювання ще невідомий.{' '}
          <Link className={styles.checkBookings} to="/bookings">
            Перевірити мої бронювання
          </Link>
        </p>
      )}
      {!date ? (
        <EmptyState title="Обери дату зустрічі" />
      ) : !currentSlots ? (
        <Loader label="Шукаємо вільний час…" />
      ) : currentSlots.kind === 'error' ? (
        <ErrorMessage error={currentSlots.error} onRetry={refreshSlots} />
      ) : currentSlots.data.slots.length === 0 ? (
        <EmptyState title="На цю дату вільного часу немає" description="Обери іншу дату або кімнату." />
      ) : (
        <ul className={styles.slots} aria-label="Вільні слоти">
          {currentSlots.data.slots.map((slot) => (
            <li className={styles.slot} key={slot.id}>
              <div>
                <p className={styles.slotTime}>
                  <time dateTime={slot.startsAt}>{formatTime(slot.startsAt)}</time>
                  {' — '}
                  <time dateTime={slot.endsAt}>{formatTime(slot.endsAt)}</time>
                </p>
                <p className={styles.slotDate}>{formatDate(slot.startsAt)}</p>
              </div>
              {canBook && (
                <button
                  type="button"
                  disabled={isBooking || uncertainSlotIds.has(slot.id)}
                  onClick={() => void handleBooking(slot)}
                >
                  {bookingSlotId === slot.id ? 'Бронюємо…' : 'Забронювати'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Простір для спільної роботи</p>
        <h1>Навчальні кімнати</h1>
        <p className={styles.intro}>Обери кімнату, дату й зручний час для своєї команди.</p>
      </header>

      {roomsState.kind === 'loading' && <Loader label="Завантажуємо кімнати…" />}
      {roomsState.kind === 'error' && (
        <ErrorMessage
          error={roomsState.error}
          onRetry={() => {
            setRoomsState({ kind: 'loading' });
            setRoomsVersion((version) => version + 1);
          }}
        />
      )}
      {roomsState.kind === 'ready' && roomsState.rooms.length === 0 && (
        <EmptyState
          title="Кімнат поки немає"
          description="Коли адміністратор додасть кімнати, вони з’являться тут."
        />
      )}
      {roomsState.kind === 'ready' && roomsState.rooms.length > 0 && (
        <div className={styles.content}>
          <section aria-labelledby="rooms-title">
            <div className={styles.sectionHeading}>
              <h2 id="rooms-title">Обери кімнату</h2>
              <span className={styles.count}>{roomsState.rooms.length}</span>
            </div>
            <ul className={styles.rooms}>
              {roomsState.rooms.map((room) => (
                <li key={room.id}>
                  <article
                    id={`room-${room.id}`}
                    className={`${styles.roomCard} ${room.id === roomId ? styles.selected : ''}`}
                  >
                    <div className={styles.cardHeading}>
                      <h3>{room.name}</h3>
                      <span className={styles.capacity}>{room.capacity} місць</span>
                    </div>
                    <p className={styles.location}>
                      {room.building} · поверх {room.floor}
                    </p>
                    {room.equipment.length > 0 ? (
                      <ul className={styles.equipment} aria-label="Обладнання">
                        {room.equipment.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.noEquipment}>Обладнання не вказано</p>
                    )}
                    <button
                      type="button"
                      className={styles.selectButton}
                      aria-pressed={room.id === roomId}
                      aria-controls="room-slots"
                      disabled={isBooking}
                      onClick={() => selectRoom(room.id)}
                    >
                      {room.id === roomId ? 'Обрано' : 'Обрати кімнату'}
                    </button>
                  </article>
                  {!isWide && room.id === roomId && availability}
                </li>
              ))}
            </ul>
          </section>

          {isWide && availability}
        </div>
      )}
    </div>
  );
}
