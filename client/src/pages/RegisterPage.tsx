import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, RegisterBody } from '@roomly/shared';
import { useAuth } from '../auth/AuthContext';
import { useAuthForm } from '../auth/useAuthForm';
import { ErrorMessage } from '../components/ErrorMessage';
import { TextField } from '../components/TextField';
import styles from './AuthPage.module.css';

// US-1.2: реєстрація студента; після неї вхід автоматичний [Рішення команди], далі список кімнат.
// Роль форма не передає: її визначає сервер (BR-14, US-1.2-AC-03).
export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { field, handleSubmit, submitting, formError, alertRef } = useAuthForm({
    initialValues: { name: '', email: '', password: '' },
    schema: RegisterBody,
    submit: auth.register,
    onSuccess: () => navigate('/rooms', { replace: true }),
    fieldForCode: { EMAIL_ALREADY_REGISTERED: 'email' },
  });

  return (
    <section className={styles.page} aria-labelledby="register-title">
      <div className={styles.heading}>
        <h1 id="register-title">Реєстрація</h1>
        <p className={styles.intro}>Створи акаунт студента особистою поштою — без університетського входу.</p>
      </div>
      <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
        {formError !== null && <ErrorMessage ref={alertRef} error={formError} />}
        <TextField {...field('name')} label="Імʼя" type="text" autoComplete="name" required />
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
          hint={`Щонайменше ${PASSWORD_MIN_LENGTH} символів.`}
          type="password"
          autoComplete="new-password"
          required
        />
        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? 'Створюємо акаунт…' : 'Зареєструватися'}
        </button>
      </form>
      <p className={styles.switch}>
        Уже маєш акаунт? <Link to="/login">Увійти</Link>
      </p>
    </section>
  );
}
