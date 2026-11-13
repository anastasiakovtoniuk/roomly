import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthRoute } from './auth/AuthRoute';
import { Layout } from './components/Layout';
import { EmptyState } from './components/EmptyState';
import { PendingPage } from './pages/PendingPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/rooms" replace />} />
        <Route element={<AuthRoute guestOnly />}>
          <Route path="login" element={<PendingPage title="Вхід" />} />
          <Route path="register" element={<PendingPage title="Реєстрація" />} />
        </Route>
        <Route element={<AuthRoute />}>
          <Route path="rooms" element={<PendingPage title="Навчальні кімнати" />} />
        </Route>
        <Route element={<AuthRoute studentOnly />}>
          <Route path="bookings" element={<PendingPage title="Мої бронювання" />} />
          <Route path="bookings/:id" element={<PendingPage title="Деталі бронювання" />} />
        </Route>
        <Route
          path="*"
          element={
            <EmptyState title="Сторінку не знайдено">
              <Link to="/rooms">До списку кімнат</Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
