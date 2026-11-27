// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Booking, BookingStatus } from '@roomly/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTime } from '../lib/dateTime';
import { BookingCheckInPrompt } from './BookingCheckInPrompt';

// Повідомлення й відлік (#44) у відкритому застосунку. Мокається лише годинник (fake timers);
// статус бронювання клієнт не змінює, після нуля лише перепитує сервер (onExpire).

const START = '2026-11-03T12:00:00.000Z';
const DEADLINE = '2026-11-03T12:15:00.000Z';

function booking(status: BookingStatus): Booking {
  return {
    id: 'booking-1',
    status,
    room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
    slot: { id: 'slot-1', startsAt: START, endsAt: '2026-11-03T13:00:00.000Z' },
    deadline: DEADLINE,
    createdAt: '2026-11-01T09:30:00.000Z',
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
  };
}

function renderPrompt(status: BookingStatus, serverTime: string, onExpire = vi.fn()) {
  const receivedAt = Date.now();
  const view = render(
    <MemoryRouter>
      <BookingCheckInPrompt
        booking={booking(status)}
        serverTime={serverTime}
        receivedAt={receivedAt}
        onExpire={onExpire}
      />
    </MemoryRouter>,
  );
  return { ...view, onExpire };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Годинник клієнта навмисно не збігається з serverTime: відлік має йти від сервера.
  vi.setSystemTime(new Date('2026-11-03T08:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Повідомлення про початок і відлік', () => {
  it('US-5.3-AC-01, US-5.4-AC-02: для активного — дедлайн, як у деталях, і відлік від serverTime', () => {
    renderPrompt('active', '2026-11-03T12:05:00.000Z');
    expect(screen.getByText(formatTime(DEADLINE))).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('10:00');
  });

  it('US-5.3-AC-01: для confirmed, cancelled_by_student, auto_cancelled відліку немає', () => {
    for (const status of ['confirmed', 'cancelled_by_student', 'auto_cancelled'] as const) {
      const { container, unmount } = renderPrompt(status, '2026-11-03T12:05:00.000Z');
      expect(container.textContent, status).toBe('');
      unmount();
    }
  });

  it('US-5.4-AC-01: до початку слота повідомлення немає', () => {
    const { container } = renderPrompt('active', '2026-11-03T11:55:00.000Z');
    expect(container.textContent).toBe('');
  });

  it('US-5.3-AC-03: відлік оновлюється щосекунди', () => {
    renderPrompt('active', '2026-11-03T12:05:00.000Z');
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole('timer').textContent).toBe('9:57');
  });

  it('US-5.3-AC-01: після нуля — «оновлюємо статус» і запит до сервера, а не «автоскасовано»', () => {
    const { onExpire } = renderPrompt('active', '2026-11-03T12:14:58.000Z');
    expect(onExpire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('Час підтвердження минув, оновлюємо статус…')).toBeTruthy();
    expect(screen.queryByText(/автоскасован/i)).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
