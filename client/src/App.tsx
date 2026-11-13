import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthRoute } from './auth/AuthRoute';
import { Layout } from './components/Layout';
import { EmptyState } from './components/EmptyState';
import { BookingDetailsPage } from './pages/BookingDetailsPage';
import { BookingsPage } from './pages/BookingsPage';
import { LoginPage } from './pages/LoginPage';
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
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="bookings/:id" element={<BookingDetailsPage />} />
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
