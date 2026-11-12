// Об'єкти й тіла відповідей — docs/contracts/api_spec.md §2, §5–7.
// Дата-час — рядок ISO 8601 в UTC (TA-4).
import type { BookingStatus, UserRole } from './domain';

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

// GET /api/rooms/:roomId/available-slots
export interface AvailableSlotListResponse {
  roomId: string;
  date: string;
  serverTime: string;
  slots: AvailableSlot[];
}

// GET /api/bookings; serverTime — основа для таймера на клієнті (TA-5).
export interface BookingListResponse {
  bookings: Booking[];
  serverTime: string;
}
