import { ERROR_CODES, ERROR_HTTP_STATUS } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import { getErrorMessage, getErrorMessageByCode } from './errorMessages';
import { ApiError, NetworkError } from './http';

// error_format.md §1: клієнт показує текст за машинним кодом; перелік кодів — лише з shared/.
describe('Тексти помилок клієнта', () => {
  it('error_format.md §1: кожен із кодів shared/ має власний непорожній текст', () => {
    const fallback = getErrorMessageByCode('INTERNAL_ERROR');
    for (const code of ERROR_CODES) {
      const text = getErrorMessageByCode(code);
      expect(text.trim().length, code).toBeGreaterThan(0);
      if (code !== 'INTERNAL_ERROR') expect(text, code).not.toBe(fallback);
    }
  });

  it('error_format.md §1: текст обирається за code, а не за message відповіді', () => {
    for (const code of ERROR_CODES) {
      const error = new ApiError(ERROR_HTTP_STATUS[code], code, 'Internal message from server');
      expect(getErrorMessage(error), code).toBe(getErrorMessageByCode(code));
    }
  });

  it('US-5.6a-AC-01, Q11: мережева помилка має окремий текст, а не загальний збій сервера', () => {
    const text = getErrorMessage(new NetworkError(new TypeError('Failed to fetch')));
    expect(text).not.toBe(getErrorMessageByCode('INTERNAL_ERROR'));
    expect(text.length).toBeGreaterThan(0);
  });
});
