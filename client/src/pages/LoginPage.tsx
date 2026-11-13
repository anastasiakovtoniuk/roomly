import { Link, useNavigate } from 'react-router';
import { LoginBody } from '@roomly/shared';
import { useAuth } from '../auth/AuthContext';
import { useAuthForm } from '../auth/useAuthForm';
import { ErrorMessage } from '../components/ErrorMessage';
import { TextField } from '../components/TextField';
import styles from './AuthPage.module.css';

// US-X.1a: вхід студента; після успіху одразу список кімнат (US-1.3-AC-01).
export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { field, handleSubmit, submitting, formError, alertRef } = useAuthForm({
    initialValues: { email: '', password: '' },
    schema: LoginBody,
    submit: auth.login,
    onSuccess: () => navigate('/rooms', { replace: true }),
  });

  return (
    <section className={styles.page} aria-labelledby="login-title">
      <div className={styles.heading}>
        <h1 id="login-title">Вхід</h1>
        <p className={styles.intro}>Увійди, щоб бронювати навчальні кімнати для своєї команди.</p>
      </div>
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        <div ref={alertRef} className={styles.alert} tabIndex={-1}>
          {formError !== null && <ErrorMessage error={formError} />}
        </div>
        <TextField
          {...field('email')}
          label="Пошта"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <TextField
          {...field('password')}
          label="Пароль"
          type="password"
          autoComplete="current-password"
          required
        />
        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? 'Входимо…' : 'Увійти'}
        </button>
      </form>
      <p className={styles.switch}>
        Ще немає акаунта? <Link to="/register">Зареєструватися</Link>
      </p>
    </section>
  );
}
