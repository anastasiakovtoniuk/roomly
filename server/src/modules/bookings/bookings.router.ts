import { Router } from 'express';
import {
  BookingIdParams,
  CreateBookingBody,
  ListMyBookingsQuery,
  type BookingListResponse,
  type BookingResponse,
} from '@roomly/shared';
import { getAuthUser, requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as bookingsService from './bookings.service';

// Ендпоінти api_spec.md §7. Лише для студента: адміністратор отримує 403 FORBIDDEN.
// Власник завжди — користувач сесії (BR-17); чужі бронювання недоступні (BR-8).
export const bookingsRouter = Router();

bookingsRouter.use(requireAuth, requireRole('student'));

bookingsRouter.post('/', validate({ body: CreateBookingBody }), async (req, res) => {
  const { slotId } = req.body as CreateBookingBody;
  const body: BookingResponse = await bookingsService.createBooking(getAuthUser(req).id, slotId);
  res.status(201).json(body);
});

bookingsRouter.get('/', validate({ query: ListMyBookingsQuery }), async (req, res) => {
  const { scope } = req.query as ListMyBookingsQuery;
  const body: BookingListResponse = await bookingsService.listMyBookings(getAuthUser(req).id, scope);
  res.json(body);
});

bookingsRouter.get('/:bookingId', validate({ params: BookingIdParams }), async (req, res) => {
  const { bookingId } = req.params as BookingIdParams;
  const body: BookingResponse = await bookingsService.getMyBooking(getAuthUser(req).id, bookingId);
  res.json(body);
});

// Тіло порожнє, але запит усе одно має бути application/json (requireJson, api_spec.md §1).
bookingsRouter.post('/:bookingId/cancel', validate({ params: BookingIdParams }), async (req, res) => {
  const { bookingId } = req.params as BookingIdParams;
  const body: BookingResponse = await bookingsService.cancelMyBooking(getAuthUser(req).id, bookingId);
  res.json(body);
});
