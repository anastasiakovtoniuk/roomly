import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';

export function AuthRoute({
  guestOnly = false,
  studentOnly = false,
}: {
  guestOnly?: boolean;
  studentOnly?: boolean;
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
  return <Outlet />;
}
