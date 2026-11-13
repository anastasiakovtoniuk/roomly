import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from './ErrorMessage';
import styles from './Layout.module.css';

export function Layout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError(null);
    try {
      await auth.logout();
      navigate('/login', { replace: true });
    } catch (error) {
      setError(error);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Перейти до вмісту
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} to="/rooms">
            Roomly<span>простір для спільних ідей</span>
          </Link>
          {auth.user && (
            <div className={styles.account}>
              <span className={styles.name}>{auth.user.name}</span>
              <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
                {loggingOut ? 'Виходимо…' : 'Вийти'}
              </button>
            </div>
          )}
        </div>
        {auth.user && (
          <nav className={styles.nav} aria-label="Головна навігація">
            <NavLink to="/rooms" className={({ isActive }) => (isActive ? styles.active : undefined)}>
              Кімнати
            </NavLink>
            {auth.user.role === 'student' && (
              <NavLink to="/bookings" className={({ isActive }) => (isActive ? styles.active : undefined)}>
                Мої бронювання
              </NavLink>
            )}
          </nav>
        )}
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        {error !== null && <ErrorMessage error={error} />}
        <Outlet />
      </main>
      <footer className={styles.footer}>Roomly · Навчальні кімнати для твоєї команди</footer>
    </div>
  );
}
