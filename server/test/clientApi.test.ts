import { afterEach, describe, expect, it, vi } from 'vitest';
import { login, logout } from '../../client/src/api/auth';
import { createBooking, listMyBookings } from '../../client/src/api/bookings';
import { getErrorMessage } from '../../client/src/api/errorMessages';
import { ApiError, apiRequest, NetworkError, subscribeToUnauthenticated } from '../../client/src/api/http';
import { listAvailableSlots } from '../../client/src/api/rooms';

afterEach(() => vi.unstubAllGlobals());

describe('Клієнтський транспорт API', () => {
  it('US-X.1a-AC-01: обірваний JSON і null не повертаються як успішна сесія', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"user":', { status: 200 }))
      .mockResolvedValueOnce(Response.json(null));
    vi.stubGlobal('fetch', fetch);
    await expect(apiRequest('/auth/me')).rejects.toBeInstanceOf(NetworkError);
    await expect(apiRequest('/auth/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('US-X.1b-AC-02: втрата сесії на захищеному API повідомляє контекст; /me не створює цикл', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'UNAUTHENTICATED',
                message: 'Вхід потрібен',
              },
            },
            { status: 401 },
          ),
        ),
      ),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthenticated(listener);
    try {
      await apiRequest('/rooms').catch(() => undefined);
      expect(listener).toHaveBeenCalledTimes(1);
      await apiRequest('/auth/me').catch(() => undefined);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
  it('US-X.1a-AC-01: вхід надсилає JSON і cookie лише на те саме походження', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ user: { id: 'student' } }));
    vi.stubGlobal('fetch', fetch);
    await login({ email: 'student@example.com', password: 'password123' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ email: 'student@example.com', password: 'password123' }),
      }),
    );
    expect(fetch.mock.calls[0]?.[1].headers.get('Content-Type')).toBe('application/json');
  });

  it('US-X.1b-AC-01: вихід з порожнім тілом має JSON Content-Type й приймає 204', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(logout()).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[1].headers.get('Content-Type')).toBe('application/json');
  });

  it('US-X.1a-AC-02: показує помилку за кодом, не довіряє message сервера', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Внутрішні дані, які не слід показувати',
            },
          },
          { status: 401 },
        ),
      ),
    );
    const error = await login({ email: 'student@example.com', password: 'wrong' }).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(getErrorMessage(error)).toBe('Неправильна пошта або пароль.');
  });

  it('US-3.4-AC-01: конфлікт бронювання зберігає статус і машинний код', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'SLOT_ALREADY_BOOKED',
              message: 'conflict',
            },
          },
          { status: 409 },
        ),
      ),
    );
    await expect(createBooking({ slotId: 'slot' })).rejects.toMatchObject({
      status: 409,
      code: 'SLOT_ALREADY_BOOKED',
    });
  });

  it('US-3.1-AC-01: невідома відповідь після запису не означає, що запис не збережено', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection lost')));
    const error = await createBooking({ slotId: 'slot' }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(NetworkError);
    expect(getErrorMessage(error)).toContain('перевір її результат перед повтором');
  });

  it('US-2.4-AC-01: скасування старого запиту не перетворюється на мережеву помилку', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(listAvailableSlots('room', { date: '2026-11-14' }, controller.signal)).rejects.toBe(error);
  });

  it('US-X.1a-AC-02: невідомий код або HTML від проксі дають безпечний запасний текст', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'NEW_CODE', message: 'private' } }, { status: 500 }),
      )
      .mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    for (let index = 0; index < 2; index++) {
      const error = await apiRequest('/auth/me').catch((error: unknown) => error);
      expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(getErrorMessage(error)).toBe('Не вдалося виконати дію. Спробуй пізніше.');
    }
  });

  it('US-4.2-AC-01: передає scope сервера й не класифікує бронювання за клієнтським часом', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ bookings: [], serverTime: '2026-11-13T00:00:00.000Z' }));
    vi.stubGlobal('fetch', fetch);
    await listMyBookings({ scope: 'upcoming' });
    expect(fetch).toHaveBeenCalledWith('/api/bookings?scope=upcoming', expect.anything());
  });

  it('US-X.1a-AC-01: заголовки Headers не губляться у спільній обгортці', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/auth/me', { headers: new Headers({ Accept: 'application/json' }) });
    expect(fetch.mock.calls[0]?.[1].headers.get('Accept')).toBe('application/json');
  });
});
