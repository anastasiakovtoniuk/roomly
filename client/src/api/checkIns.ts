import type { CheckInBody, CheckInResult } from '@roomly/shared';
import { apiRequest } from './http';

// POST /api/check-ins (api_spec.md §8). Токен передається без змін (TA-12) і лише в тілі запиту.
export function checkIn(body: CheckInBody): Promise<CheckInResult> {
  return apiRequest('/check-ins', { method: 'POST', body: JSON.stringify(body) });
}
