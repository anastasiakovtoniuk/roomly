// Схеми Zod вхідних даних — docs/contracts/api_spec.md §5–7, §11.
// Одні й ті самі на клієнті (зручність) і сервері (обов'язкова перевірка), ADR-0003.
// Невідомі поля відкидаються: так ігнорується `role` у реєстрації (BR-14, FB-14).
import { z } from 'zod';
import { BOOKING_SCOPES, PASSWORD_MIN_LENGTH } from './domain';

// [Пропозиція] Q08: межі імені й пароля.
const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 254;
// Верхня межа — обмеження bcrypt [Пропозиція]; bcrypt рахує байти, а контракт — символи.
const PASSWORD_MAX_LENGTH = 72;

// BR-14: пошта зберігається й порівнюється без пробілів по краях і в нижньому регістрі.
// Нормалізація йде до перевірки формату, щоб пробіли не давали помилку.
const Email = z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).pipe(z.email());

export const RegisterBody = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  email: Email,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.object({
  email: Email,
  // Довжину не перевіряємо, щоб не розкривати правила пароля (api_spec.md §5).
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const RoomIdParams = z.object({ roomId: z.uuid() });
export type RoomIdParams = z.infer<typeof RoomIdParams>;

export const BookingIdParams = z.object({ bookingId: z.uuid() });
export type BookingIdParams = z.infer<typeof BookingIdParams>;

// Реальна календарна дата YYYY-MM-DD у часовому поясі університету (G9).
export const AvailableSlotsQuery = z.object({ date: z.iso.date() });
export type AvailableSlotsQuery = z.infer<typeof AvailableSlotsQuery>;

// Власник — користувач сесії (BR-17), тому в тілі лише slotId.
export const CreateBookingBody = z.object({ slotId: z.uuid() });
export type CreateBookingBody = z.infer<typeof CreateBookingBody>;

export const ListMyBookingsQuery = z.object({ scope: z.enum(BOOKING_SCOPES) });
export type ListMyBookingsQuery = z.infer<typeof ListMyBookingsQuery>;
