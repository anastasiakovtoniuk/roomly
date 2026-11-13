import type { LoginBody, LoginResponse, MeResponse, RegisterBody, RegisterResponse } from '@roomly/shared';
import { apiRequest } from './http';

export function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return apiRequest('/auth/me', { signal });
}

export function login(body: LoginBody): Promise<LoginResponse> {
  return apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

export function register(body: RegisterBody): Promise<RegisterResponse> {
  return apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(body) });
}

export function logout(): Promise<void> {
  return apiRequest('/auth/logout', { method: 'POST' });
}
