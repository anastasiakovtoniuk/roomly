// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Booking, BookingResponse, BookingStatus } from '@roomly/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingDetailsPage } from './BookingDetailsPage';

// Дії в деталях бронювання (#78). Мокається лише fetch; вигляд кнопок перевіряє чекліст #53 (SM-27).

const fetchMock = vi.fn<typeof fetch>();

function booking(status: BookingStatus): Booking {
  return {
    id: 'booking-1',
    status,
    room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
    // Слот далеко в майбутньому: повідомлення й відлік #44 тут не з'являються.
    slot: { id: 'slot-1', startsAt: '2099-11-03T12:00:00.000Z', endsAt: '2099-11-03T13:00:00.000Z' },
    deadline: '2099-11-03T12:15:00.000Z',
    createdAt: '2026-11-01T09:30:00.000Z',
    confirmedAt: status === 'confirmed' ? '2099-11-03T12:05:00.000Z' : null,
    confirmedBy: status === 'confirmed' ? 'student' : null,
    cancelledAt: null,
  };
}

function respondWith(status: BookingStatus) {
  const body: BookingResponse = { booking: booking(status), serverTime: '2026-11-27T10:00:00.000Z' };
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/bookings/booking-1']}>
      <Routes>
        <Route path="bookings/:id" element={<BookingDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Дії в деталях бронювання', () => {
  it('US-5.1, US-4.3-AC-01 (#78): для активного — «Підтвердити присутність» і «Скасувати бронювання» в одному блоці', async () => {
    respondWith('active');
    renderPage();

    const checkIn = await screen.findByRole('link', { name: 'Підтвердити присутність' });
    const cancel = screen.getByRole('button', { name: 'Скасувати бронювання' });
    expect(checkIn.getAttribute('href')).toBe('/check-in');
    expect(checkIn.parentElement).toBe(cancel.parentElement);
  });

  it('US-4.3-AC-01: «Скасувати бронювання» відкриває підтвердження й нічого не надсилає', async () => {
    respondWith('active');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Скасувати бронювання' }));

    expect(screen.getByRole('group', { name: 'Підтвердження скасування' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скасувати бронювання' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('US-4.3-AC-01, FB-1: для підтвердженого — жодної з двох дій', async () => {
    respondWith('confirmed');
    renderPage();

    expect(await screen.findByText('Підтверджене')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Підтвердити присутність' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скасувати бронювання' })).toBeNull();
  });
});
