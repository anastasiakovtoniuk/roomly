import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CheckInBody } from '@roomly/shared';
import { checkIn } from '../api/checkIns';
import { QrScanner } from '../components/QrScanner';
import { TextField } from '../components/TextField';
import { bookingStatusLabel, bookingStatusTone } from '../lib/bookingView';
import {
  checkInStateFromError,
  checkInStateFromResult,
  checkInStateText,
  isCheckInSuccess,
  offlineCheckInState,
  type CheckInScreenState,
} from '../lib/checkIn';
import { formatDate, formatTime } from '../lib/dateTime';
import bookingStyles from './Bookings.module.css';
import styles from './CheckInPage.module.css';

type Phase = { step: 'scan' } | { step: 'sending' } | { step: 'result'; state: CheckInScreenState };

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// US-5.1, US-5.2, US-5.6a, US-5.6b: підтвердження присутності скануванням QR кімнати.
// Підтвердити може будь-який студент; результат і вікно підтвердження визначає сервер.
export function CheckInPage() {
  const [phase, setPhase] = useState<Phase>({ step: 'scan' });
  const [manualToken, setManualToken] = useState('');
  const [manualError, setManualError] = useState<string | undefined>();
  // Прочитаний токен живе лише в пам'яті сторінки для повтору (US-5.6b): не в стані React,
  // URL, localStorage чи логах (FB-12).
  const tokenRef = useRef<string | null>(null);
  // Синхронний замок: другий запит не надсилається, поки триває перший.
  const sendingLock = useRef(false);
  const pageVersion = useRef(0);

  useEffect(() => {
    return () => {
      // Відповідь після виходу зі сторінки не оновлює стан; запит не скасовуємо, бо він міг зберегтися.
      pageVersion.current += 1;
      tokenRef.current = null;
    };
  }, []);

  async function send() {
    const qrToken = tokenRef.current;
    if (sendingLock.current || qrToken === null) return;
    // Без мережі запит не надсилаємо: підтвердження точно не збережено (US-5.6a-AC-01, AC-02).
    if (isOffline()) {
      setPhase({ step: 'result', state: offlineCheckInState() });
      return;
    }
    sendingLock.current = true;
    const version = pageVersion.current;
    setPhase({ step: 'sending' });
    let state: CheckInScreenState;
    try {
      state = checkInStateFromResult(await checkIn({ qrToken }));
    } catch (error) {
      state = checkInStateFromError(error, { offline: isOffline() });
    } finally {
      sendingLock.current = false;
    }
    if (version !== pageVersion.current) return;
    // Токен потрібен лише для повтору після мережевої помилки; інакше одразу забуваємо його.
    if (!state.retry) tokenRef.current = null;
    setPhase({ step: 'result', state });
  }

  function handleDetected(value: string) {
    if (sendingLock.current) return;
    tokenRef.current = value;
    void send();
  }

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingLock.current) return;
    // Без trim: вміст QR передається без змін (TA-12); межі ті самі, що й на сервері.
    const parsed = CheckInBody.safeParse({ qrToken: manualToken });
    if (!parsed.success) {
      setManualError(
        manualToken.length === 0
          ? 'Введи код із QR кімнати.'
          : 'Код задовгий. Перевір, що ввів саме код кімнати.',
      );
      return;
    }
    setManualError(undefined);
    // Введений токен після відправлення не показується (#36, питання 7).
    setManualToken('');
    tokenRef.current = parsed.data.qrToken;
    void send();
  }

  function scanAgain() {
    tokenRef.current = null;
    setPhase({ step: 'scan' });
  }

  return (
    <div className={styles.page}>
      <div className={bookingStyles.heading}>
        <h1>Підтвердити присутність</h1>
        <p className={bookingStyles.intro}>
          Відскануй QR-код у кімнаті після початку бронювання й до дедлайну підтвердження. Підтвердити може
          будь-який студент, що прийшов, не лише той, хто бронював.
        </p>
      </div>

      {phase.step === 'scan' && (
        <>
          <QrScanner onDetected={handleDetected} />
          <form className={styles.manual} onSubmit={handleManualSubmit} noValidate>
            <h2>Немає камери?</h2>
            <TextField
              id="check-in-token"
              label="Код із QR кімнати"
              hint="Встав вміст QR без змін, наприклад прочитаний камерою телефона в іншому застосунку."
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              error={manualError}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit">Підтвердити</button>
          </form>
        </>
      )}

      <div aria-live="polite" className={styles.live}>
        {phase.step === 'sending' && (
          <p className={styles.sending} role="status">
            Надсилаємо підтвердження…
          </p>
        )}
        {phase.step === 'result' && (
          <CheckInOutcome state={phase.state} onRetry={() => void send()} onScanAgain={scanAgain} />
        )}
      </div>
    </div>
  );
}

function CheckInOutcome({
  state,
  onRetry,
  onScanAgain,
}: {
  state: CheckInScreenState;
  onRetry: () => void;
  onScanAgain: () => void;
}) {
  const text = checkInStateText(state);
  const success = isCheckInSuccess(state);

  return (
    <section
      className={`${styles.result} ${success ? styles.success : styles.failure}`}
      aria-labelledby="check-in-result"
    >
      <h2 id="check-in-result">{text.title}</h2>
      {text.description && <p>{text.description}</p>}

      {/* Лише кімната, час і статус: даних власника бронювання тут немає (US-5.2-AC-04, FB-12). */}
      {success && (
        <dl className={bookingStyles.facts}>
          <div>
            <dt>Кімната</dt>
            <dd>
              {state.booking.room.name} · {state.booking.room.building}, поверх {state.booking.room.floor}
            </dd>
          </div>
          <div>
            <dt>Дата</dt>
            <dd>
              <time dateTime={state.booking.slot.startsAt}>{formatDate(state.booking.slot.startsAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Час</dt>
            <dd>
              <time dateTime={state.booking.slot.startsAt}>{formatTime(state.booking.slot.startsAt)}</time>–
              <time dateTime={state.booking.slot.endsAt}>{formatTime(state.booking.slot.endsAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Статус</dt>
            <dd>
              <span
                className={`${bookingStyles.status} ${bookingStyles[bookingStatusTone(state.booking.status)]}`}
              >
                {bookingStatusLabel(state.booking.status)}
              </span>
            </dd>
          </div>
        </dl>
      )}

      <div className={styles.actions}>
        {state.retry && (
          <button type="button" onClick={onRetry}>
            Повторити
          </button>
        )}
        <button type="button" className={bookingStyles.secondary} onClick={onScanAgain}>
          {state.retry ? 'Сканувати інший код' : 'Сканувати ще раз'}
        </button>
        {success && (
          <Link className={styles.link} to="/bookings">
            До моїх бронювань
          </Link>
        )}
      </div>
    </section>
  );
}
