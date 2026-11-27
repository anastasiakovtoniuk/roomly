import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Room, Slot } from '@roomly/shared';
import { createSlot } from '../api/adminRooms';
import { getErrorMessage } from '../api/errorMessages';
import { ApiError } from '../api/http';
import { readValidationFields } from '../auth/fieldErrors';
import { ErrorMessage } from '../components/ErrorMessage';
import { TextField } from '../components/TextField';
import fieldStyles from '../components/TextField.module.css';
import {
  SLOT_FIELD_ORDER,
  slotFieldErrors,
  slotRequest,
  type FormErrors,
  type SlotField,
  type SlotFormValues,
} from '../lib/adminForms';
import { formatDate, formatTime, universityDate } from '../lib/dateTime';
import { useFocusRequest } from '../lib/useFocusRequest';
import styles from './AdminRoomsPage.module.css';

const PREFIX = 'new-slot';
const fieldId = (field: SlotField) => `${PREFIX}-${field}`;

// Створення слота (US-A.2). Один слот на запит ([Пропозиція] api_spec.md §9). Перетин, «та сама дата»
// ([Пропозиція] G7) і «ще не завершився» ([Пропозиція] Q10) остаточно перевіряє сервер.
export function AdminSlotForm({ rooms, onRoomMissing }: { rooms: Room[]; onRoomMissing: () => void }) {
  const [values, setValues] = useState<SlotFormValues>(() => ({
    roomId: '',
    date: universityDate(),
    startTime: '',
    endTime: '',
  }));
  const [errors, setErrors] = useState<FormErrors<SlotField>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ slot: Slot; roomName: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const requestFocus = useFocusRequest();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Після оновлення списку обрана кімната може зникнути: тоді обирається перша наявна.
  const roomId = rooms.some((room) => room.id === values.roomId) ? values.roomId : (rooms[0]?.id ?? '');
  const current: SlotFormValues = { ...values, roomId };

  function showErrors(next: FormErrors<SlotField>, error: unknown) {
    setErrors(next);
    setFormError(error);
    const first = SLOT_FIELD_ORDER.find((field) => next[field] !== undefined);
    if (first) requestFocus(() => document.getElementById(fieldId(first)));
    else if (error !== null) requestFocus(() => alertRef.current);
  }

  function showFailure(error: unknown, submitted: SlotFormValues) {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR') {
        const { errors: next, complete } = slotFieldErrors(readValidationFields(error.details), submitted);
        showErrors(next, complete ? null : error);
        return;
      }
      if (error.code === 'SLOT_OVERLAP') {
        showErrors({ startTime: getErrorMessage(error) }, null);
        return;
      }
      if (error.code === 'ROOM_NOT_FOUND') {
        onRoomMissing();
        showErrors({ roomId: getErrorMessage(error) }, null);
        return;
      }
    }
    showErrors({}, error);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setFormError(null);
    setCreated(null);

    const submitted = current;
    const request = slotRequest(submitted);
    if (!request.ok) {
      showErrors(request.errors, null);
      return;
    }

    lock.current = true;
    setSubmitting(true);
    setErrors({});
    try {
      const { slot } = await createSlot(submitted.roomId, request.body);
      if (!mounted.current) return;
      const roomName = rooms.find((room) => room.id === slot.roomId)?.name ?? '';
      setCreated({ slot, roomName });
      // Кімната й дата лишаються: так зручно додати кілька слотів поспіль.
      setValues((old) => ({ ...old, startTime: '', endTime: '' }));
    } catch (error) {
      if (mounted.current) showFailure(error, submitted);
    } finally {
      lock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  function field(name: Exclude<SlotField, 'roomId'>) {
    return {
      id: fieldId(name),
      name,
      value: values[name],
      error: errors[name],
      readOnly: submitting,
      onChange: (event: { target: { value: string } }) => {
        const { value } = event.target;
        setValues((old) => ({ ...old, [name]: value }));
        setErrors((old) => {
          if (old[name] === undefined) return old;
          const next = { ...old };
          delete next[name];
          return next;
        });
      },
    };
  }

  const roomErrorId = `${fieldId('roomId')}-error`;

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      {formError !== null && <ErrorMessage ref={alertRef} error={formError} />}
      <div className={fieldStyles.field}>
        <label className={fieldStyles.label} htmlFor={fieldId('roomId')}>
          Кімната
        </label>
        <select
          id={fieldId('roomId')}
          className={fieldStyles.input}
          value={roomId}
          disabled={submitting}
          aria-invalid={errors.roomId ? true : undefined}
          aria-describedby={errors.roomId ? roomErrorId : undefined}
          onChange={(event) => {
            const { value } = event.target;
            setValues((old) => ({ ...old, roomId: value }));
            setErrors((old) => ({ ...old, roomId: undefined }));
          }}
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} · {room.building}, поверх {room.floor}
            </option>
          ))}
        </select>
        {errors.roomId && (
          <p id={roomErrorId} className={fieldStyles.error}>
            {errors.roomId}
          </p>
        )}
      </div>
      <TextField {...field('date')} label="Дата" type="date" min={universityDate()} />
      <div className={styles.timeRow}>
        <TextField {...field('startTime')} label="Початок" type="time" step={60} />
        <TextField {...field('endTime')} label="Завершення" type="time" step={60} />
      </div>
      <p className={styles.hint}>Дата й час за часовим поясом університету.</p>
      {created && (
        <p className={styles.notice} role="status">
          Слот створено: {created.roomName}, {formatDate(created.slot.startsAt)},{' '}
          {formatTime(created.slot.startsAt)}–{formatTime(created.slot.endsAt)}.{' '}
          <Link to="/rooms">Переглянути в каталозі</Link>
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={submitting || rooms.length === 0}>
          {submitting ? 'Створюємо…' : 'Створити слот'}
        </button>
      </div>
    </form>
  );
}
