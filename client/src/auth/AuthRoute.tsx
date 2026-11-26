import { Link, Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';

export function AuthRoute({
  guestOnly = false,
  studentOnly = false,
  adminOnly = false,
}: {
  guestOnly?: boolean;
  studentOnly?: boolean;
  adminOnly?: boolean;
}) {
  const auth = useAuth();
  if (auth.status === 'loading') return <Loader label="Перевіряємо вхід…" />;
  if (auth.status === 'error') {
    return <ErrorMessage error={auth.error} onRetry={() => void auth.refresh()} />;
  }
  if (guestOnly) {
    return auth.user ? <Navigate to="/rooms" replace /> : <Outlet />;
  }
  if (!auth.user) return <Navigate to="/login" replace />;
  if (studentOnly && auth.user.role !== 'student') {
    return (
      <EmptyState
        title="Бронювання доступні студентам"
        description="Увійди зі студентського акаунта, щоб керувати власними бронюваннями."
      />
    );
  }
  // Прихований екран не замінює перевірку прав: /api/admin/* закриває сервер (SYS-AC-09).
  if (adminOnly && auth.user.role !== 'admin') {
    return (
      <EmptyState
        title="Розділ доступний адміністратору"
        description="Керування кімнатами й слотами відкривається лише з акаунта адміністратора."
      >
        <Link to="/rooms">До списку кімнат</Link>
      </EmptyState>
    );
  }
  return <Outlet />;
}
