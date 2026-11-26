import { CreateRoomBody, UpdateRoomBody, type Room } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import { issuesToFields } from '../auth/fieldErrors';
import {
  roomChanges,
  roomFieldErrors,
  roomFormInput,
  roomToFormValues,
  slotFieldErrors,
  slotRequest,
  type RoomFormValues,
} from './adminForms';

const room: Room = {
  id: '8f1a2b3c-0000-4000-8000-000000000001',
  name: 'R101',
  capacity: 6,
  building: 'Корпус 1',
  floor: 2,
  equipment: ['Проєктор', 'Дошка'],
};

function roomErrors(values: RoomFormValues) {
  const parsed = CreateRoomBody.safeParse(roomFormInput(values));
  if (parsed.success) throw new Error('Очікувалась помилка схеми');
  return roomFieldErrors(issuesToFields(parsed.error.issues), values);
}

function roomData(values: RoomFormValues) {
  const parsed = CreateRoomBody.safeParse(roomFormInput(values));
  if (!parsed.success) throw new Error('Очікувались валідні дані');
  return parsed.data;
}

describe('Форма кімнати адміністратора', () => {
  it('US-A.1a-AC-01: рядки форми стають тілом CreateRoomBody з числами й обрізаними назвами', () => {
    expect(
      roomData({ name: ' R202 ', capacity: '8', building: 'Корпус 2', floor: '-1', equipment: [' Екран '] }),
    ).toEqual({ name: 'R202', capacity: 8, building: 'Корпус 2', floor: -1, equipment: ['Екран'] });
  });

  it('US-A.1a-AC-01: порожні й нецілі поля дають тексти біля відповідних полів', () => {
    const { errors, complete } = roomErrors({
      name: '  ',
      capacity: '1.5',
      building: '',
      floor: '1e2',
      equipment: ['Проєктор', ''],
    });
    expect(complete).toBe(true);
    expect(errors).toEqual({
      name: 'Вкажи назву кімнати.',
      capacity: 'Кількість місць — ціле число.',
      building: 'Вкажи корпус.',
      floor: 'Поверх — ціле число, наприклад 0 або 2.',
      'equipment.1': 'Назви обладнання або видали цей рядок.',
    });
  });

  it('US-A.1a-AC-01: нульова місткість і повтор обладнання мають власні тексти', () => {
    const { errors } = roomErrors({
      ...roomToFormValues(room),
      capacity: '0',
      equipment: ['Дошка', ' Дошка'],
    });
    expect(errors.capacity).toBe('Кімната має вміщати хоча б одну особу.');
    expect(errors.equipment).toBe('Обладнання повторюється. Прибери однакові рядки.');
  });

  it('US-A.1b-AC-03: у PATCH іде лише змінене поле; без змін тіло відхиляється', () => {
    expect(roomChanges(roomData({ ...roomToFormValues(room), capacity: '10' }), room)).toEqual({
      capacity: 10,
    });
    const unchanged = roomChanges(roomData(roomToFormValues(room)), room);
    expect(unchanged).toEqual({});
    expect(UpdateRoomBody.safeParse(unchanged).success).toBe(false);
  });

  it('US-A.1b-AC-01: змінене обладнання надсилається цілим переліком', () => {
    expect(roomChanges(roomData({ ...roomToFormValues(room), equipment: ['Проєктор'] }), room)).toEqual({
      equipment: ['Проєктор'],
    });
    expect(
      roomChanges(roomData({ ...roomToFormValues(room), equipment: ['Дошка', 'Проєктор'] }), room),
    ).toEqual({ equipment: ['Дошка', 'Проєктор'] });
  });

  it('US-A.1b-AC-01: помилка сервера поза полями форми не ховається', () => {
    const { errors, complete } = roomFieldErrors(
      [
        { path: 'roomId', reason: 'invalid_format' },
        { path: 'name', reason: 'too_big' },
      ],
      roomToFormValues(room),
    );
    expect(errors).toEqual({ name: 'Назва задовга. Скороти її.' });
    expect(complete).toBe(false);
  });
});

describe('Форма слота адміністратора', () => {
  const base = { roomId: room.id, date: '2026-11-30', startTime: '10:00', endTime: '11:00' };

  it('US-A.2-AC-01: дата й час у поясі університету стають тілом CreateSlotBody в UTC', () => {
    expect(slotRequest(base, 'Europe/Kyiv')).toEqual({
      ok: true,
      body: { startsAt: '2026-11-30T08:00:00.000Z', endsAt: '2026-11-30T09:00:00.000Z' },
    });
  });

  it('US-A.2-AC-01: порожні поля позначаються до запиту', () => {
    expect(slotRequest({ roomId: '', date: '', startTime: '', endTime: '' }, 'Europe/Kyiv')).toEqual({
      ok: false,
      errors: {
        roomId: 'Обери кімнату.',
        date: 'Вкажи дату.',
        startTime: 'Вкажи час початку.',
        endTime: 'Вкажи час завершення.',
      },
    });
  });

  it('US-A.2-AC-01: завершення не пізніше за початок CreateSlotBody відхиляє біля поля завершення', () => {
    expect(slotRequest({ ...base, endTime: '10:00' }, 'Europe/Kyiv')).toEqual({
      ok: false,
      errors: { endTime: 'Завершення має бути пізніше за початок.' },
    });
  });

  it('US-A.2-AC-01: пропущений навесні час позначається біля свого поля', () => {
    expect(
      slotRequest({ ...base, date: '2026-03-29', startTime: '03:30', endTime: '05:00' }, 'Europe/Kyiv'),
    ).toEqual({
      ok: false,
      errors: { startTime: 'Такого часу цього дня немає через перехід на літній час.' },
    });
  });

  it('US-A.2-AC-01: відмова сервера custom для endsAt за правильного порядку часу — слот уже завершився (Q10)', () => {
    expect(slotFieldErrors([{ path: 'endsAt', reason: 'custom' }], base).errors).toEqual({
      endTime: 'Слот уже завершився. Обери пізніший час.',
    });
  });
});
