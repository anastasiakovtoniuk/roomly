import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CreateRoomBody, UpdateRoomBody, type Room } from '@roomly/shared';
import { createRoom, updateRoom } from '../api/adminRooms';
import { ApiError } from '../api/http';
import { issuesToFields, readValidationFields } from '../auth/fieldErrors';
import { ErrorMessage } from '../components/ErrorMessage';
import { TextField } from '../components/TextField';
import {
  EMPTY_ROOM_VALUES,
  roomChanges,
  roomFieldErrors,
  roomFieldOrder,
  roomFormInput,
  roomToFormValues,
  type FormErrors,
  type RoomFieldKey,
  type RoomFormValues,
} from '../lib/adminForms';
import { useFocusRequest } from '../lib/useFocusRequest';
import styles from './AdminRoomsPage.module.css';

type TextRoomField = 'name' | 'capacity' | 'building' | 'floor';

// Створення (US-A.1a) і редагування (US-A.1b) кімнати: одна форма, room задає режим.
export function AdminRoomForm({
  room,
  onSaved,
  onCancel,
  onRoomMissing,
}: {
  room?: Room;
  onSaved: (room: Room) => void;
  onCancel?: () => void;
  onRoomMissing?: () => void;
}) {
  const prefix = room ? `edit-room-${room.id}` : 'new-room';
  const [values, setValues] = useState<RoomFormValues>(() =>
    room ? roomToFormValues(room) : EMPTY_ROOM_VALUES,
  );
  const [errors, setErrors] = useState<FormErrors<RoomFieldKey>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Синхронний замок: Enter і клік до наступного render не надсилають другий запит.
  const lock = useRef(false);
  const mounted = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const requestFocus = useFocusRequest();
  const fieldId = (key: RoomFieldKey) => `${prefix}-${key.replace('.', '-')}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Форма редагування відкривається на місці картки: фокус переходить на її перше поле.
  const editing = room !== undefined;
  useEffect(() => {
    if (editing) document.getElementById(`${prefix}-name`)?.focus();
  }, [editing, prefix]);

  function showErrors(next: FormErrors<RoomFieldKey>, error: unknown, submitted: RoomFormValues) {
    setErrors(next);
    setFormError(error);
    const first = roomFieldOrder(submitted).find((key) => next[key] !== undefined);
    if (first) {
      // Загальна помилка переліку обладнання не має власного поля: фокус на кнопці додавання.
      requestFocus(() =>
        first === 'equipment' ? addButtonRef.current : document.getElementById(fieldId(first)),
      );
    } else if (error !== null) {
      requestFocus(() => alertRef.current);
    }
  }

  function showFailure(error: unknown, submitted: RoomFormValues) {
    if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
      const { errors: next, complete } = roomFieldErrors(readValidationFields(error.details), submitted);
      showErrors(next, complete ? null : error, submitted);
      return;
    }
    // Кімнату видалили з-під форми: список оновлюється, повідомлення лишається.
    if (error instanceof ApiError && error.code === 'ROOM_NOT_FOUND') onRoomMissing?.();
    showErrors({}, error, submitted);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setFormError(null);
    setNotice(null);

    // Клієнтська перевірка лише для зручності: сервер перевіряє ті самі схеми обов'язково.
    const submitted = values;
    const parsed = CreateRoomBody.safeParse(roomFormInput(submitted));
    if (!parsed.success) {
      const { errors: next } = roomFieldErrors(issuesToFields(parsed.error.issues), submitted);
      showErrors(next, null, submitted);
      return;
    }
    let request: () => Promise<{ room: Room }>;
    if (room) {
      const changes = UpdateRoomBody.safeParse(roomChanges(parsed.data, room));
      if (!changes.success) {
        setErrors({});
        setNotice('Змін немає: зберігати нічого.');
        return;
      }
      request = () => updateRoom(room.id, changes.data);
    } else {
      request = () => createRoom(parsed.data);
    }

    lock.current = true;
    setSubmitting(true);
    setErrors({});
    let saved: Room;
    try {
      ({ room: saved } = await request());
    } catch (error) {
      if (mounted.current) showFailure(error, submitted);
      return;
    } finally {
      lock.current = false;
      if (mounted.current) setSubmitting(false);
    }
    // Список у батьківському компоненті оновлюється навіть тоді, коли форму вже закрито.
    onSaved(saved);
    if (mounted.current && !room) {
      setValues(EMPTY_ROOM_VALUES);
      setNotice(`Кімнату «${saved.name}» створено.`);
    }
  }

  // Будь-яка зміна робить застарілими і помилку поля, і повідомлення «Змін немає» чи «створено».
  function clearError(key: RoomFieldKey) {
    setNotice(null);
    setErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function textField(name: TextRoomField) {
    return {
      id: fieldId(name),
      name,
      value: values[name],
      error: errors[name],
      readOnly: submitting,
      onChange: (event: { target: { value: string } }) => {
        const { value } = event.target;
        setValues((current) => ({ ...current, [name]: value }));
        clearError(name);
      },
    };
  }

  // Після зміни переліку індекси зсуваються, тож помилки окремих елементів більше не відповідають рядкам.
  function withoutEquipmentErrors(current: FormErrors<RoomFieldKey>) {
    const next = { ...current };
    for (const key of Object.keys(next) as RoomFieldKey[]) {
      if (key.startsWith('equipment')) delete next[key];
    }
    return next;
  }

  function addEquipment() {
    const index = values.equipment.length;
    setValues((current) => ({ ...current, equipment: [...current.equipment, ''] }));
    setErrors(withoutEquipmentErrors);
    requestFocus(() => document.getElementById(fieldId(`equipment.${index}`)));
  }

  function removeEquipment(index: number) {
    setValues((current) => ({
      ...current,
      equipment: current.equipment.filter((_, itemIndex) => itemIndex !== index),
    }));
    setErrors(withoutEquipmentErrors);
    requestFocus(() => addButtonRef.current);
  }

  const equipmentErrorId = `${prefix}-equipment-error`;

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      {formError !== null && <ErrorMessage ref={alertRef} error={formError} />}
      <TextField {...textField('name')} label="Назва" autoComplete="off" />
      <TextField
        {...textField('capacity')}
        label="Кількість місць"
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
      />
      <TextField {...textField('building')} label="Корпус" autoComplete="off" />
      <TextField
        {...textField('floor')}
        label="Поверх"
        hint="Ціле число, наприклад 0 або 2."
        type="number"
        step={1}
      />
      <fieldset
        className={styles.equipment}
        aria-describedby={errors.equipment ? equipmentErrorId : undefined}
      >
        <legend>Обладнання</legend>
        <p className={styles.hint}>Наприклад, проєктор чи дошка. Перелік можна лишити порожнім.</p>
        {values.equipment.map((item, index) => {
          const key: RoomFieldKey = `equipment.${index}`;
          return (
            <div className={styles.equipmentItem} key={index}>
              <TextField
                id={fieldId(key)}
                label={`Обладнання ${index + 1}`}
                value={item}
                error={errors[key]}
                readOnly={submitting}
                autoComplete="off"
                onChange={(event) => {
                  const { value } = event.target;
                  setValues((current) => ({
                    ...current,
                    equipment: current.equipment.map((old, itemIndex) => (itemIndex === index ? value : old)),
                  }));
                  clearError(key);
                  clearError('equipment');
                }}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={submitting}
                aria-label={`Видалити обладнання ${index + 1}`}
                onClick={() => removeEquipment(index)}
              >
                Видалити
              </button>
            </div>
          );
        })}
        {errors.equipment && (
          <p id={equipmentErrorId} className={styles.fieldError}>
            {errors.equipment}
          </p>
        )}
        <button
          ref={addButtonRef}
          type="button"
          className={styles.secondaryButton}
          disabled={submitting}
          onClick={addEquipment}
        >
          Додати обладнання
        </button>
      </fieldset>
      {notice !== null && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Зберігаємо…' : room ? 'Зберегти зміни' : 'Створити кімнату'}
        </button>
        {onCancel && (
          <button type="button" className={styles.secondaryButton} disabled={submitting} onClick={onCancel}>
            Скасувати
          </button>
        )}
      </div>
    </form>
  );
}
