import { useEffect, useState } from 'react';
import type { HealthResponse } from '@roomly/shared';
import { ApiError, apiRequest } from '../api/http';
import styles from './HomePage.module.css';

// Сторінка-заглушка Walking Skeleton: назва проєкту, майбутні екрани й перевірка зв'язку UI → API → БД.

interface PlannedScreen {
  title: string;
  stories: string;
}

const STUDENT_SCREENS: PlannedScreen[] = [
  { title: 'Вхід і реєстрація', stories: 'US-1.2, US-X.1a, US-X.1b' },
  { title: 'Список кімнат', stories: 'US-1.3, US-2.1–2.3' },
  { title: 'Кімната й вільні слоти', stories: 'US-2.4, US-2.6, US-3.1, US-3.4' },
  { title: 'Мої бронювання й історія', stories: 'US-4.1, US-4.2, US-4.3, US-X.3' },
  { title: 'Деталі бронювання з таймером', stories: 'US-3.2a, US-3.2b, US-5.3, US-5.4' },
  { title: 'Сканування QR', stories: 'US-5.1, US-5.2, US-5.6a, US-5.6b' },
];

const ADMIN_SCREENS: PlannedScreen[] = [
  { title: 'Кімнати', stories: 'US-A.1a, US-A.1b' },
  { title: 'Слоти кімнати', stories: 'US-A.2' },
  { title: 'QR-коди й друк', stories: 'US-A.4a, US-A.4b' },
  { title: 'Усі бронювання', stories: 'US-A.5, US-A.6, US-A.7' },
];

type HealthState =
  { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error'; message: string };

export function HomePage() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    apiRequest<HealthResponse>('/health')
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? `${err.status} ${err.code}` : 'Сервер недоступний';
        setState({ kind: 'error', message });
      });
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Roomly</h1>
        <p className={styles.subtitle}>Бронювання навчальних кімнат із QR-підтвердженням присутності</p>
      </header>

      <section className={styles.card} aria-live="polite">
        <h2 className={styles.cardTitle}>Стан системи</h2>
        <HealthStatus state={state} />
      </section>

      <ScreenList title="Екрани студента" screens={STUDENT_SCREENS} />
      <ScreenList title="Екрани адміністратора" screens={ADMIN_SCREENS} />

      <footer className={styles.footer}>Walking Skeleton · екрани ще не реалізовано</footer>
    </main>
  );
}

function HealthStatus({ state }: { state: HealthState }) {
  if (state.kind === 'loading') {
    return <p className={styles.muted}>Перевіряємо з’єднання…</p>;
  }
  if (state.kind === 'error') {
    return (
      <dl className={styles.status}>
        <dt>API</dt>
        <dd className={styles.bad}>{state.message}</dd>
      </dl>
    );
  }

  const { database, serverTime } = state.health;
  return (
    <dl className={styles.status}>
      <dt>API</dt>
      <dd className={styles.good}>працює</dd>
      <dt>База даних</dt>
      <dd className={database === 'ok' ? styles.good : styles.bad}>
        {database === 'ok' ? 'підключена' : 'недоступна'}
      </dd>
      <dt>Час сервера</dt>
      <dd>{new Date(serverTime).toLocaleString('uk-UA')}</dd>
    </dl>
  );
}

function ScreenList({ title, screens }: { title: string; screens: PlannedScreen[] }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <ul className={styles.screens}>
        {screens.map((screen) => (
          <li key={screen.title} className={styles.screen}>
            <span>{screen.title}</span>
            <span className={styles.stories}>{screen.stories}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
