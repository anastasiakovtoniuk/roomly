import { Router } from 'express';
import { CreateBookingBody, type BookingResponse } from '@roomly/shared';
import { getAuthUser, requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as bookingsService from './bookings.service';

// Ендпоінти api_spec.md §7. Лише для студента: адміністратор отримує 403 FORBIDDEN.
export const bookingsRouter = Router();

bookingsRouter.use(requireAuth, requireRole('student'));

bookingsRouter.post('/', validate({ body: CreateBookingBody }), async (req, res) => {
  const { slotId } = req.body as CreateBookingBody;
  const body: BookingResponse = await bookingsService.createBooking(getAuthUser(req).id, slotId);
  res.status(201).json(body);
});
