import type {
  BookingListResponse,
  BookingResponse,
  CreateBookingBody,
  ListMyBookingsQuery,
} from '@roomly/shared';
import { apiRequest } from './http';

export function createBooking(body: CreateBookingBody): Promise<BookingResponse> {
  return apiRequest('/bookings', { method: 'POST', body: JSON.stringify(body) });
}

export function listMyBookings(
  query: ListMyBookingsQuery,
  signal?: AbortSignal,
): Promise<BookingListResponse> {
  return apiRequest(`/bookings?${new URLSearchParams({ scope: query.scope })}`, { signal });
}

export function getBooking(bookingId: string, signal?: AbortSignal): Promise<BookingResponse> {
  return apiRequest(`/bookings/${encodeURIComponent(bookingId)}`, { signal });
}

export function cancelBooking(bookingId: string): Promise<BookingResponse> {
  return apiRequest(`/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' });
}
