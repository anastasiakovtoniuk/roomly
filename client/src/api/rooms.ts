import type { AvailableSlotListResponse, AvailableSlotsQuery, RoomListResponse } from '@roomly/shared';
import { apiRequest } from './http';

export function listRooms(signal?: AbortSignal): Promise<RoomListResponse> {
  return apiRequest('/rooms', { signal });
}

export function listAvailableSlots(
  roomId: string,
  query: AvailableSlotsQuery,
  signal?: AbortSignal,
): Promise<AvailableSlotListResponse> {
  const params = new URLSearchParams({ date: query.date });
  return apiRequest(`/rooms/${encodeURIComponent(roomId)}/available-slots?${params}`, { signal });
}
