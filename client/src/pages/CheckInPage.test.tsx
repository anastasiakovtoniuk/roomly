// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { CheckInResult } from '@roomly/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckInPage } from './CheckInPage';

// Поведінка повтору на екрані підтвердження (#43): мокаємо лише fetch і navigator.onLine.
// У jsdom немає камери й захищеного контексту, тож токен вводиться резервним полем.

const TOKEN = 'room-qr-token';

const confirmed: CheckInResult = {
  result: 'confirmed',
  booking: {
    id: 'booking-1',
    status: 'confirmed',
    room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
    slot: { id: 'slot-1', startsAt: '2026-11-03T12:00:00.000Z', endsAt: '2026-11-03T13:00:00.000Z' },
    deadline: '2026-11-03T12:15:00.000Z',
    createdAt: '2026-11-01T09:30:00.000Z',
    confirmedAt: '2026-11-03T12:05:00.000Z',
    confirmedBy: 'student',
    cancelledAt: null,
  },
  serverTime: '2026-11-03T12:05:00.000Z',
};

const fetchMock = vi.fn<typeof fetch>();
let online = true;

beforeEach(() => {
  online = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  render(
    <MemoryRouter>
      <CheckInPage />
    </MemoryRouter>,
  );
}

function submitToken() {
  fireEvent.change(screen.getByLabelText('Код із QR кімнати'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
}

function sentBodies(): unknown[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe('Екран підтвердження: мережа й повтор', () => {
  it('US-5.6a-AC-01, US-5.6a-AC-02: офлайн — запит не надсилається, «не збережено», успіху немає', async () => {
    online = false;
    renderPage();
    submitToken();

    expect(await screen.findByText('Підтвердження не збережено: немає зв’язку')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Присутність підтверджено')).toBeNull();
    // Введений токен після відправлення не показується (#36, питання 7).
    expect(screen.queryByDisplayValue(TOKEN)).toBeNull();
  });

  it('US-5.6b-AC-01, US-5.6b-AC-02: після відновлення мережі «Повторити» надсилає той самий запит один раз', async () => {
    online = false;
    renderPage();
    submitToken();
    const retry = await screen.findByRole('button', { name: 'Повторити' });

    online = true;
    fetchMock.mockResolvedValueOnce(okResponse(confirmed));
    fireEvent.click(retry);

    expect(await screen.findByText('Присутність підтверджено')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBodies()).toEqual([{ qrToken: TOKEN }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/check-ins');
  });

  it('US-5.6b-AC-01: після втраченої відповіді повтор не відправляється автоматично, лише за кнопкою', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPage();
    submitToken();

    const retry = await screen.findByRole('button', { name: 'Повторити' });
    expect(screen.getByText('Немає відповіді від сервера')).toBeTruthy();
    // Чекаємо ще кілька тактів: жодного другого запиту без натискання.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(okResponse({ ...confirmed, result: 'already_confirmed' }));
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(await screen.findByText('Бронювання вже підтверджене')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBodies()).toEqual([{ qrToken: TOKEN }, { qrToken: TOKEN }]);
  });

  it('US-5.6b-AC-03: після CHECK_IN_WINDOW_CLOSED кнопки «Повторити» немає', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'CHECK_IN_WINDOW_CLOSED', message: 'closed' } }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderPage();
    submitToken();

    expect(await screen.findByText('Час підтвердження минув')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторити' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
