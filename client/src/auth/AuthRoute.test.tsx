// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { User, UserRole } from '@roomly/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './AuthContext';
import { AuthRoute } from './AuthRoute';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));

afterEach(cleanup);

function signedInAs(role: UserRole | null) {
  const user: User | null = role && { id: 'user', name: 'Тест', email: 'user@example.com', role };
  vi.mocked(useAuth).mockReturnValue({
    ...(user
      ? { status: 'authenticated' as const, user, error: null }
      : { status: 'anonymous' as const, user: null, error: null }),
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function renderAdminRoute() {
  render(
    <MemoryRouter initialEntries={['/admin/rooms']}>
      <Routes>
        <Route path="login" element={<p>Сторінка входу</p>} />
        <Route element={<AuthRoute adminOnly />}>
          <Route path="admin/rooms" element={<p>Форми адміністратора</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// Лише відображення; доступ до /api/admin/* перевіряє сервер (server/test/admin*.test.ts).
describe('AuthRoute adminOnly', () => {
  it('SYS-AC-09: студент бачить пояснення замість адмін-форм', () => {
    signedInAs('student');
    renderAdminRoute();
    expect(screen.getByRole('heading', { name: 'Розділ доступний адміністратору' })).toBeTruthy();
    expect(screen.queryByText('Форми адміністратора')).toBeNull();
  });

  it('SYS-AC-09: гість переходить на сторінку входу', () => {
    signedInAs(null);
    renderAdminRoute();
    expect(screen.getByText('Сторінка входу')).toBeTruthy();
    expect(screen.queryByText('Форми адміністратора')).toBeNull();
  });

  it('SYS-AC-09: адміністратор бачить вміст розділу', () => {
    signedInAs('admin');
    renderAdminRoute();
    expect(screen.getByText('Форми адміністратора')).toBeTruthy();
  });
});
