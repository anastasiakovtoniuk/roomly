import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthRoute } from './auth/AuthRoute';
import { Layout } from './components/Layout';
import { EmptyState } from './components/EmptyState';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';
import { RegisterPage } from './pages/RegisterPage';
import { RoomsPage } from './pages/RoomsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/rooms" replace />} />
        <Route element={<AuthRoute guestOnly />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>
        <Route element={<AuthRoute />}>
          <Route path="rooms" element={<RoomsPage />} />
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
