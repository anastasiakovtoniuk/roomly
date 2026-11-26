import type {
  CreateRoomBody,
  CreateSlotBody,
  RoomResponse,
  SlotResponse,
  UpdateRoomBody,
} from '@roomly/shared';
import { apiRequest } from './http';

// Адмін-API кімнат і слотів (api_spec.md §9). Роль перевіряє сервер; qrToken у відповідях немає.

export function createRoom(body: CreateRoomBody): Promise<RoomResponse> {
  return apiRequest('/admin/rooms', { method: 'POST', body: JSON.stringify(body) });
}

export function updateRoom(roomId: string, body: UpdateRoomBody): Promise<RoomResponse> {
  return apiRequest(`/admin/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function createSlot(roomId: string, body: CreateSlotBody): Promise<SlotResponse> {
  return apiRequest(`/admin/rooms/${encodeURIComponent(roomId)}/slots`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
