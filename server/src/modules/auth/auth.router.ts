import { Router } from 'express';
import {
  LoginBody,
  RegisterBody,
  type LoginResponse,
  type MeResponse,
  type RegisterResponse,
} from '@roomly/shared';
import { getAuthUser, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as authService from './auth.service';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session';

// Ендпоінти api_spec.md §5. Тіла вже перевірені й нормалізовані validate.
export const authRouter = Router();

authRouter.post('/register', validate({ body: RegisterBody }), async (req, res) => {
  const { user, token } = await authService.register(req.body as RegisterBody, readSessionToken(req));
  setSessionCookie(req, res, token);
  const body: RegisterResponse = { user };
  res.status(201).json(body);
});

authRouter.post('/login', validate({ body: LoginBody }), async (req, res) => {
  const { user, token } = await authService.login(req.body as LoginBody, readSessionToken(req));
  setSessionCookie(req, res, token);
  const body: LoginResponse = { user };
  res.json(body);
});

authRouter.post('/logout', async (req, res) => {
  await authService.logout(readSessionToken(req));
  clearSessionCookie(req, res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  const body: MeResponse = { user: getAuthUser(req) };
  res.json(body);
});
