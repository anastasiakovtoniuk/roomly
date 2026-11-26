import {
  CreateSlotBody,
  type CreateRoomBody,
  type Room,
  type UpdateRoomBody,
  type ValidationFieldError,
} from '@roomly/shared';
import { issuesToFields } from '../auth/fieldErrors';
import { APP_TIMEZONE, universityDateTimeToUtc } from './dateTime';

// Чиста логіка адмін-форм кімнати й слота (US-A.1a, US-A.1b, US-A.2). Межі полів задають лише схеми
// shared/ ([Пропозиція] Q09); тут — перетворення рядків форми й тексти біля полів за reason.

export type FormErrors<K extends string> = Partial<Record<K, string>>;

export type RoomFormValues = {
  name: string;
  capacity: string;
  building: string;
  floor: string;
  equipment: string[];
};

export type RoomField = 'name' | 'capacity' | 'building' | 'floor' | 'equipment';
// Помилка окремого елемента обладнання має шлях `equipment.<індекс>`, як у details.fields сервера.
export type RoomFieldKey = RoomField | `equipment.${number}`;

export const EMPTY_ROOM_VALUES: RoomFormValues = {
  name: '',
  capacity: '',
  building: '',
  floor: '',
  equipment: [],
};

export function roomToFormValues(room: Room): RoomFormValues {
  return {
    name: room.name,
    capacity: String(room.capacity),
    building: room.building,
    floor: String(room.floor),
    equipment: [...room.equipment],
  };
}

// Порожнє поле лишається undefined, щоб схема відхилила його як відсутнє. Лише цифри зі знаком
// перетворюються на число: «1e2» чи «0x10» стають NaN, і z.int() їх відхиляє.
function toInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

// Вхід для CreateRoomBody.safeParse: обрізання й перевірку виконує схема.
export function roomFormInput(values: RoomFormValues): Record<RoomField, unknown> {
  return {
    name: values.name,
    capacity: toInteger(values.capacity),
    building: values.building,
    floor: toInteger(values.floor),
    equipment: values.equipment,
  };
}

// US-A.1b-AC-03: у PATCH ідуть лише змінені поля; equipment замінює перелік цілком, тому за будь-якої
// зміни надсилається весь список. Порожній результат UpdateRoomBody відхиляє («хоча б одне поле»).
export function roomChanges(data: CreateRoomBody, room: Room): UpdateRoomBody {
  const changes: UpdateRoomBody = {};
  if (data.name !== room.name) changes.name = data.name;
  if (data.capacity !== room.capacity) changes.capacity = data.capacity;
  if (data.building !== room.building) changes.building = data.building;
  if (data.floor !== room.floor) changes.floor = data.floor;
  if (
    data.equipment.length !== room.equipment.length ||
    data.equipment.some((item, index) => item !== room.equipment[index])
  ) {
    changes.equipment = data.equipment;
  }
  return changes;
}

function roomFieldMessage(key: RoomFieldKey, reason: string, values: RoomFormValues): string {
  if (key.startsWith('equipment.')) {
    const value = values.equipment[Number(key.slice('equipment.'.length))] ?? '';
    if (value.trim() === '') return 'Назви обладнання або видали цей рядок.';
    return reason === 'too_big' ? 'Назва обладнання задовга. Скороти її.' : 'Перевір назву обладнання.';
  }
  switch (key) {
    case 'name':
      if (values.name.trim() === '') return 'Вкажи назву кімнати.';
      return reason === 'too_big' ? 'Назва задовга. Скороти її.' : 'Перевір назву кімнати.';
    case 'building':
      if (values.building.trim() === '') return 'Вкажи корпус.';
      return reason === 'too_big' ? 'Назва корпусу задовга. Скороти її.' : 'Перевір корпус.';
    case 'capacity':
      if (values.capacity.trim() === '') return 'Вкажи кількість місць.';
      return reason === 'too_small'
        ? 'Кімната має вміщати хоча б одну особу.'
        : 'Кількість місць — ціле число.';
    case 'floor':
      if (values.floor.trim() === '') return 'Вкажи поверх.';
      return 'Поверх — ціле число, наприклад 0 або 2.';
    default:
      if (reason === 'too_big') return 'Забагато позицій обладнання. Видали зайві.';
      if (reason === 'custom') return 'Обладнання повторюється. Прибери однакові рядки.';
      return 'Перевір перелік обладнання.';
  }
}

function isRoomFieldKey(path: string, values: RoomFormValues): path is RoomFieldKey {
  if (['name', 'capacity', 'building', 'floor', 'equipment'].includes(path)) return true;
  const item = /^equipment\.(\d+)$/.exec(path);
  return item !== null && Number(item[1]) < values.equipment.length;
}

// Як collectFieldErrors для форм входу: complete = false, якщо є помилка поза полями форми
// (наприклад, `roomId` у шляху чи порожнє тіло PATCH) — тоді показується загальне повідомлення.
export function roomFieldErrors(
  issues: readonly ValidationFieldError[],
  values: RoomFormValues,
): { errors: FormErrors<RoomFieldKey>; complete: boolean } {
  const errors: FormErrors<RoomFieldKey> = {};
  let complete = issues.length > 0;
  for (const { path, reason } of issues) {
    if (!isRoomFieldKey(path, values)) {
      complete = false;
      continue;
    }
    errors[path] ??= roomFieldMessage(path, reason, values);
  }
  return { errors, complete };
}

// Порядок фокуса: поля форми згори вниз, елементи обладнання — перед загальною помилкою переліку.
export function roomFieldOrder(values: RoomFormValues): RoomFieldKey[] {
  return [
    'name',
    'capacity',
    'building',
    'floor',
    ...values.equipment.map((_, index): RoomFieldKey => `equipment.${index}`),
    'equipment',
  ];
}

export type SlotFormValues = {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type SlotField = keyof SlotFormValues;

const SLOT_PATH_TO_FIELD: Record<string, SlotField> = {
  roomId: 'roomId',
  startsAt: 'startTime',
  endsAt: 'endTime',
};

function slotFieldMessage(field: SlotField, reason: string, values: SlotFormValues): string {
  switch (field) {
    case 'roomId':
      return 'Обери кімнату зі списку.';
    case 'date':
      return 'Перевір дату.';
    case 'startTime':
      return 'Перевір час початку.';
    case 'endTime':
      if (reason !== 'custom') return 'Перевір час завершення.';
      // reason `custom` дає і BR-13 (CreateSlotBody), і правила сервера [Пропозиція] G7/Q10:
      // та сама дата університету й endsAt > now. Форма має одну дату, тож розрізняємо за часом.
      return values.endTime <= values.startTime
        ? 'Завершення має бути пізніше за початок.'
        : 'Слот уже завершився. Обери пізніший час.';
  }
}

export function slotFieldErrors(
  issues: readonly ValidationFieldError[],
  values: SlotFormValues,
): { errors: FormErrors<SlotField>; complete: boolean } {
  const errors: FormErrors<SlotField> = {};
  let complete = issues.length > 0;
  for (const { path, reason } of issues) {
    const field = SLOT_PATH_TO_FIELD[path];
    if (!field) {
      complete = false;
      continue;
    }
    errors[field] ??= slotFieldMessage(field, reason, values);
  }
  return { errors, complete };
}

export const SLOT_FIELD_ORDER: readonly SlotField[] = ['roomId', 'date', 'startTime', 'endTime'];

// Форма → тіло POST /api/admin/rooms/:roomId/slots. Час переводиться з поясу університету в UTC,
// далі перевіряє та сама CreateSlotBody, що й сервер.
export function slotRequest(
  values: SlotFormValues,
  timeZone = APP_TIMEZONE,
): { ok: true; body: CreateSlotBody } | { ok: false; errors: FormErrors<SlotField> } {
  const errors: FormErrors<SlotField> = {};
  if (values.roomId === '') errors.roomId = 'Обери кімнату.';
  if (values.date === '') errors.date = 'Вкажи дату.';
  if (values.startTime === '') errors.startTime = 'Вкажи час початку.';
  if (values.endTime === '') errors.endTime = 'Вкажи час завершення.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const startsAt = universityDateTimeToUtc(values.date, values.startTime, timeZone);
  const endsAt = universityDateTimeToUtc(values.date, values.endTime, timeZone);
  // Невалідна дата дає null для обох; неіснуючий час переходу на літній — лише для свого поля.
  if (startsAt === null && endsAt === null) return { ok: false, errors: { date: 'Перевір дату.' } };
  const missingTime = 'Такого часу цього дня немає через перехід на літній час.';
  if (startsAt === null) errors.startTime = missingTime;
  if (endsAt === null) errors.endTime = missingTime;
  if (startsAt === null || endsAt === null) return { ok: false, errors };

  const parsed = CreateSlotBody.safeParse({ startsAt, endsAt });
  if (parsed.success) return { ok: true, body: parsed.data };
  return { ok: false, errors: slotFieldErrors(issuesToFields(parsed.error.issues), values).errors };
}
