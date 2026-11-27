// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Booking, BookingListResponse } from '@roomly/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingsPage } from './BookingsPage';

// Регресія #76: вкладка «Активні» рахується за поточною оцінкою серверного часу, а не за serverTime
// останньої відповіді. Мокаються лише fetch і годинник; межа рівно в кінці слота не фіксується.

const SERVER_TIME = '2026-11-03T12:59:55.000Z';

const ongoing: Booking = {
  id: 'booking-1',
  status: 'confirmed',
  room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
  // Слот завершується через 5 с після відповіді сервера.
  slot: { id: 'slot-1', startsAt: '2026-11-03T12:00:00.000Z', endsAt: '2026-11-03T13:00:00.000Z' },
  deadline: '2026-11-03T12:15:00.000Z',
  createdAt: '2026-11-01T09:30:00.000Z',
  confirmedAt: '2026-11-03T12:05:00.000Z',
  confirmedBy: 'student',
  cancelledAt: null,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // Годинник клієнта навмисно на 2 год попереду: поділ має йти від serverTime, а не від нього.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-03T14:59:55.000Z'));
  const body: BookingListResponse = { bookings: [ongoing], serverTime: SERVER_TIME };
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Вкладка «Активні»', () => {
  it('US-4.2-AC-01, US-X.3-AC-01 (#76): після кінця слота бронювання зникає з «Активних» без нового запиту', async () => {
    render(
      <MemoryRouter initialEntries={['/bookings?scope=ongoing']}>
        <BookingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('R101')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 10 с — далеко за кінцем слота, але раніше за опитування раз на 30 с.
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(screen.queryByText('R101')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
