// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

afterEach(cleanup);

// Димова перевірка налаштування компонентних тестів (jsdom + Testing Library), issue #48.
describe('налаштування тестів клієнта', () => {
  it('US-1.3-AC-02 порожній стан показує заголовок і пояснення, а без пояснення абзацу немає', () => {
    render(<EmptyState title="Кімнат немає" description="Адміністратор ще не додав кімнати" />);
    expect(screen.getByRole('heading', { name: 'Кімнат немає' })).toBeTruthy();
    expect(screen.getByText('Адміністратор ще не додав кімнати')).toBeTruthy();

    cleanup();
    render(<EmptyState title="Кімнат немає" />);
    expect(screen.queryByText('Адміністратор ще не додав кімнати')).toBeNull();
  });
});
