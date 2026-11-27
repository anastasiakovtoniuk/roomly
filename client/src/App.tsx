import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthRoute } from './auth/AuthRoute';
import { Layout } from './components/Layout';
import { EmptyState } from './components/EmptyState';
import { AdminRoomsPage } from './pages/AdminRoomsPage';
import { BookingDetailsPage } from './pages/BookingDetailsPage';
import { BookingsPage } from './pages/BookingsPage';
import { CheckInPage } from './pages/CheckInPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RoomsPage } from './pages/RoomsPage';

// Адміністратор підтверджує присутність вручну (US-A.7, #46), а не скануванням QR (api_spec.md §8).
const CHECK_IN_STUDENT_ONLY_TEXT = {
  title: 'Підтвердження за QR доступне студентам',
  description: 'Увійди зі студентського акаунта, щоб підтвердити присутність у кімнаті.',
};

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
        <Route element={<AuthRoute studentOnly studentOnlyText={CHECK_IN_STUDENT_ONLY_TEXT} />}>
          <Route path="check-in" element={<CheckInPage />} />
        </Route>
        <Route element={<AuthRoute adminOnly />}>
          <Route path="admin" element={<Navigate to="/admin/rooms" replace />} />
          <Route path="admin/rooms" element={<AdminRoomsPage />} />
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
