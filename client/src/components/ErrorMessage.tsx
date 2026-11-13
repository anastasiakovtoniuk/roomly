import { getErrorMessage } from '../api/errorMessages';
import styles from './Feedback.module.css';

export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <p>{getErrorMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Спробувати ще раз
        </button>
      )}
    </div>
  );
}
