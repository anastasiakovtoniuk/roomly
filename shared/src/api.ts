// Об'єкти й тіла відповідей — docs/contracts/api_spec.md §2, §5–9.
// Дата-час — рядок ISO 8601 в UTC (TA-4).
import type { BookingStatus, CheckInResultKind, UserRole } from './domain';

// passwordHash і дані сесій не повертаються ніколи.
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

// qrToken не входить у Room (FB-12).
export interface Room {
  id: string;
  name: string;
  capacity: number;
  building: string;
  floor: number;
  equipment: string[];
}

export interface Slot {
  id: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
}

export interface AvailableSlot extends Slot {
  releasedByAutoCancel: boolean;
}

// Даних власника немає, тому об'єкт можна віддавати й тому, хто підтвердив чуже бронювання (US-5.2).
export interface Booking {
  id: string;
  // Перелік розширюється за G2/Q03; клієнт показує невідоме значення нейтрально.
  status: BookingStatus;
  room: Pick<Room, 'id' | 'name' | 'building' | 'floor'>;
  slot: Pick<Slot, 'id' | 'startsAt' | 'endsAt'>;
  deadline: string;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: UserRole | null;
  cancelledAt: string | null;
}

// POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
export interface AuthUserResponse {
  user: User;
}
export type RegisterResponse = AuthUserResponse;
export type LoginResponse = AuthUserResponse;
export type MeResponse = AuthUserResponse;

// GET /api/rooms
export interface RoomListResponse {
  rooms: Room[];
}

// GET /api/rooms/:roomId
export interface RoomResponse {
  room: Room;
}

// GET /api/rooms/:roomId/available-slots
export interface AvailableSlotListResponse {
  roomId: string;
  date: string;
  serverTime: string;
  slots: AvailableSlot[];
}

// POST /api/bookings; serverTime — основа для таймера на клієнті (TA-5).
export interface BookingResponse {
  booking: Booking;
  serverTime: string;
}

// GET /api/bookings; serverTime — основа для таймера на клієнті (TA-5).
export interface BookingListResponse {
  bookings: Booking[];
  serverTime: string;
}

// Бронювання для адміністратора: Booking + власник (US-A.5). Студентам не повертається.
export interface AdminBooking extends Booking {
  student: Pick<User, 'id' | 'name' | 'email'>;
}

// POST /api/check-ins, POST /api/admin/bookings/:bookingId/confirm; обидва result — успіх (BR-10).
export interface CheckInResult {
  result: CheckInResultKind;
  booking: Booking;
  serverTime: string;
}

// GET /api/admin/bookings
export interface AdminBookingListResponse {
  bookings: AdminBooking[];
  serverTime: string;
}

// POST /api/admin/rooms/:roomId/slots
export interface SlotResponse {
  slot: Slot;
}

// GET /api/admin/rooms/:roomId/qr — лише адміністратору (FB-12); той самий токен при повторі (FB-13).
export interface QrTokenResponse {
  roomId: string;
  roomName: string;
  qrToken: string;
}
