import { Router } from 'express';
import {
  CreateRoomBody,
  CreateSlotBody,
  RoomIdParams,
  UpdateRoomBody,
  type QrTokenResponse,
  type RoomResponse,
  type SlotResponse,
} from '@roomly/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as adminRoomsService from './adminRooms.service';

// Адмін-ендпоінти кімнат і слотів (api_spec.md §9). Перевірка ролі стоїть до маршрутів і діє на
// весь /api/admin/*: гість — 401 UNAUTHENTICATED, студент — 403 FORBIDDEN навіть на неіснуючий шлях,
// щоб не розкривати, які адмін-маршрути є (BR-15, SYS-AC-09). Роль — лише із сесії (BR-17).
// Редагування й видалення слотів немає (Q17/G6).
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.post('/rooms', validate({ body: CreateRoomBody }), async (req, res) => {
  const body: RoomResponse = { room: await adminRoomsService.createRoom(req.body as CreateRoomBody) };
  res.status(201).json(body);
});

adminRouter.patch(
  '/rooms/:roomId',
  validate({ params: RoomIdParams, body: UpdateRoomBody }),
  async (req, res) => {
    const { roomId } = req.params as RoomIdParams;
    const body: RoomResponse = {
      room: await adminRoomsService.updateRoom(roomId, req.body as UpdateRoomBody),
    };
    res.json(body);
  },
);

adminRouter.post(
  '/rooms/:roomId/slots',
  validate({ params: RoomIdParams, body: CreateSlotBody }),
  async (req, res) => {
    const { roomId } = req.params as RoomIdParams;
    const { startsAt, endsAt } = req.body as CreateSlotBody;
    const body: SlotResponse = { slot: await adminRoomsService.createSlot(roomId, startsAt, endsAt) };
    res.status(201).json(body);
  },
);

adminRouter.get('/rooms/:roomId/qr', validate({ params: RoomIdParams }), async (req, res) => {
  const { roomId } = req.params as RoomIdParams;
  const body: QrTokenResponse = await adminRoomsService.getRoomQrToken(roomId);
  res.json(body);
});
