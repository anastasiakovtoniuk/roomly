import { Router } from 'express';
import {
  AvailableSlotsQuery,
  RoomIdParams,
  type AvailableSlotListResponse,
  type Room,
  type RoomListResponse,
} from '@roomly/shared';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as roomsService from './rooms.service';

// Ендпоінти api_spec.md §6. Роль — будь-який авторизований користувач, тому лише requireAuth.
export const roomsRouter = Router();

roomsRouter.use(requireAuth);

roomsRouter.get('/', async (_req, res) => {
  const body: RoomListResponse = { rooms: await roomsService.listRooms() };
  res.json(body);
});

roomsRouter.get('/:roomId', validate({ params: RoomIdParams }), async (req, res) => {
  const { roomId } = req.params as RoomIdParams;
  const body: { room: Room } = { room: await roomsService.getRoom(roomId) };
  res.json(body);
});

roomsRouter.get(
  '/:roomId/available-slots',
  validate({ params: RoomIdParams, query: AvailableSlotsQuery }),
  async (req, res) => {
    const { roomId } = req.params as RoomIdParams;
    const { date } = req.query as AvailableSlotsQuery;
    const body: AvailableSlotListResponse = await roomsService.listAvailableSlots(roomId, date);
    res.json(body);
  },
);
