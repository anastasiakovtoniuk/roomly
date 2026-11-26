import { useEffect, useState } from 'react';
import type { Room } from '@roomly/shared';
import { listRooms } from '../api/rooms';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import { useFocusRequest } from '../lib/useFocusRequest';
import { AdminRoomForm } from './AdminRoomForm';
import { AdminSlotForm } from './AdminSlotForm';
import styles from './AdminRoomsPage.module.css';

type RoomsState = { kind: 'loading' } | { kind: 'ready'; rooms: Room[] } | { kind: 'error'; error: unknown };

// /admin/rooms: кімнати й слоти адміністратора (US-A.1a, US-A.1b, US-A.2). Список — той самий
// GET /api/rooms, що бачить студент, тож після збереження адміністратор бачить дані каталогу.
// Токен QR тут не показується (FB-12): друк QR — окремий екран #46.
export function AdminRoomsPage() {
  const [roomsState, setRoomsState] = useState<RoomsState>({ kind: 'loading' });
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const requestFocus = useFocusRequest();

  // Після закриття форми фокус повертається на кнопку «Редагувати» тієї самої кімнати.
  function closeEditing(roomId: string) {
    setEditingRoomId(null);
    requestFocus(() => document.getElementById(`edit-room-button-${roomId}`));
  }

  useEffect(() => {
    const controller = new AbortController();
    void listRooms(controller.signal).then(
      ({ rooms }) => {
        if (!controller.signal.aborted) setRoomsState({ kind: 'ready', rooms });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setRoomsState({ kind: 'error', error });
      },
    );
    return () => controller.abort();
  }, [roomsVersion]);

  // Попередній список лишається на екрані під час оновлення: форми не зникають і не втрачають введене.
  function refreshRooms() {
    setRoomsVersion((version) => version + 1);
  }

  const rooms = roomsState.kind === 'ready' ? roomsState.rooms : [];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Адміністрування</p>
        <h1>Кімнати й слоти</h1>
        <p className={styles.intro}>
          Додай кімнату, зміни її дані або створи слот. Студенти побачать зміни в каталозі.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="new-room-title">
        <h2 id="new-room-title">Нова кімната</h2>
        <AdminRoomForm
          onSaved={(room) => {
            setSavedNotice(null);
            setRoomsState((state) =>
              state.kind === 'ready' ? { kind: 'ready', rooms: [...state.rooms, room] } : state,
            );
            refreshRooms();
          }}
        />
      </section>

      <section className={styles.card} aria-labelledby="new-slot-title">
        <h2 id="new-slot-title">Новий слот</h2>
        {roomsState.kind === 'loading' && <Loader label="Завантажуємо кімнати…" />}
        {roomsState.kind === 'error' && (
          <p className={styles.hint}>Слот можна створити після завантаження кімнат.</p>
        )}
        {roomsState.kind === 'ready' && rooms.length === 0 && (
          <p className={styles.hint}>Спершу створи кімнату.</p>
        )}
        {rooms.length > 0 && <AdminSlotForm rooms={rooms} onRoomMissing={refreshRooms} />}
      </section>

      <section aria-labelledby="rooms-title">
        <div className={styles.sectionHeading}>
          <h2 id="rooms-title">Кімнати</h2>
          {roomsState.kind === 'ready' && <span className={styles.count}>{rooms.length}</span>}
        </div>
        {savedNotice !== null && (
          <p className={styles.notice} role="status">
            {savedNotice}
          </p>
        )}
        {roomsState.kind === 'loading' && <Loader label="Завантажуємо кімнати…" />}
        {roomsState.kind === 'error' && (
          <ErrorMessage
            error={roomsState.error}
            onRetry={() => {
              setRoomsState({ kind: 'loading' });
              refreshRooms();
            }}
          />
        )}
        {roomsState.kind === 'ready' && rooms.length === 0 && (
          <EmptyState title="Кімнат поки немає" description="Створи першу кімнату у формі вище." />
        )}
        {rooms.length > 0 && (
          <ul className={styles.rooms}>
            {rooms.map((room) => (
              <li key={room.id} className={styles.card}>
                {editingRoomId === room.id ? (
                  <>
                    <h3>Редагування: {room.name}</h3>
                    <AdminRoomForm
                      room={room}
                      onCancel={() => closeEditing(room.id)}
                      onRoomMissing={refreshRooms}
                      onSaved={(saved) => {
                        closeEditing(saved.id);
                        setSavedNotice(`Зміни кімнати «${saved.name}» збережено.`);
                        setRoomsState((state) =>
                          state.kind === 'ready'
                            ? {
                                kind: 'ready',
                                rooms: state.rooms.map((item) => (item.id === saved.id ? saved : item)),
                              }
                            : state,
                        );
                        refreshRooms();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div className={styles.cardHeading}>
                      <h3>{room.name}</h3>
                      <span className={styles.capacity}>{room.capacity} місць</span>
                    </div>
                    <p className={styles.location}>
                      {room.building} · поверх {room.floor}
                    </p>
                    <p className={styles.location}>
                      {room.equipment.length > 0
                        ? `Обладнання: ${room.equipment.join(', ')}`
                        : 'Обладнання не вказано'}
                    </p>
                    <button
                      id={`edit-room-button-${room.id}`}
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        setSavedNotice(null);
                        setEditingRoomId(room.id);
                      }}
                    >
                      Редагувати
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
