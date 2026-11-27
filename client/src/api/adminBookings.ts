import type { AdminBookingListResponse, CheckInResult, QrTokenResponse } from '@roomly/shared';
import { apiRequest } from './http';

// Адмін-API QR і бронювань (api_spec.md §9). Роль перевіряє сервер.

// Токен потрібен лише для побудови зображення QR на клієнті (US-A.4b): його не показують
// текстом, не кладуть в URL і не зберігають (FB-12).
export function getRoomQr(roomId: string, signal?: AbortSignal): Promise<QrTokenResponse> {
  return apiRequest(`/admin/rooms/${encodeURIComponent(roomId)}/qr`, { signal });
}

export function listAdminBookings(signal?: AbortSignal): Promise<AdminBookingListResponse> {
  return apiRequest('/admin/bookings', { signal });
}

export function confirmBooking(bookingId: string): Promise<CheckInResult> {
  return apiRequest(`/admin/bookings/${encodeURIComponent(bookingId)}/confirm`, { method: 'POST' });
}
