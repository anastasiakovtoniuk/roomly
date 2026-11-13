import styles from './Feedback.module.css';

export function Loader({ label = 'Завантажуємо…' }: { label?: string }) {
  return (
    <p className={styles.loader} role="status">
      {label}
    </p>
  );
}
