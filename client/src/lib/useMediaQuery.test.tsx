// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

// jsdom не має matchMedia: підміняємо його керованим об'єктом, щоб перевірити підписку й перемикання.
function installMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial };
  const queries: string[] = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      queries.push(query);
      return {
        get matches() {
          return state.matches;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      };
    }),
  );
  return {
    queries,
    listeners,
    setMatches(next: boolean) {
      state.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Розкладка каталогу кімнат залежить від ширини (US-2.4): панель вільного часу або під обраною
// кімнатою, або правою колонкою. Хук має вірно визначати збіг і реагувати на зміну ширини.
describe('useMediaQuery', () => {
  it('US-2.4 повертає поточний збіг media query та передає запит у matchMedia', () => {
    const media = installMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery('(min-width: 58rem)'));

    expect(result.current).toBe(true);
    expect(media.queries).toContain('(min-width: 58rem)');
  });

  it('US-2.4 вузький екран: збігу немає, хук повертає false', () => {
    installMatchMedia(false);

    const { result } = renderHook(() => useMediaQuery('(min-width: 58rem)'));

    expect(result.current).toBe(false);
  });

  it('US-2.4 перетин межі ширини перемикає значення без перезавантаження компонента', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 58rem)'));
    expect(result.current).toBe(false);

    act(() => media.setMatches(true));
    expect(result.current).toBe(true);

    act(() => media.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('US-2.4 після розмонтування підписка знімається, щоб не лишалось слухачів', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 58rem)'));
    expect(media.listeners.size).toBeGreaterThan(0);

    unmount();

    expect(media.listeners.size).toBe(0);
  });
});
