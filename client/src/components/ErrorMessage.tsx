import type { Ref } from 'react';
import { getErrorMessage } from '../api/errorMessages';
import styles from './Feedback.module.css';

// ref потрібен формам: фокус переводиться на саме повідомлення, а не на безіменну обгортку.
export function ErrorMessage({
  error,
  onRetry,
  ref,
}: {
  error: unknown;
  onRetry?: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={styles.error} role="alert" tabIndex={ref ? -1 : undefined}>
      <p>{getErrorMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Спробувати ще раз
        </button>
      )}
    </div>
  );
}
