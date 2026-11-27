import { Router } from 'express';
import { CheckInBody, type CheckInResult } from '@roomly/shared';
import { getAuthUser, requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as checkInsService from './checkIns.service';

// POST /api/check-ins (api_spec.md §8). Лише для студента: адміністратор підтверджує вручну (US-A.7)
// і тут отримує 403 FORBIDDEN. Хто підтверджує — лише користувач сесії (BR-17, FB-11).
export const checkInsRouter = Router();

checkInsRouter.use(requireAuth, requireRole('student'));

checkInsRouter.post('/', validate({ body: CheckInBody }), async (req, res) => {
  const { qrToken } = req.body as CheckInBody;
  const body: CheckInResult = await checkInsService.checkIn(getAuthUser(req).id, qrToken);
  res.json(body);
});
