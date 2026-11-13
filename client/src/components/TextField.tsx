import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';

type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'id' | 'aria-invalid' | 'aria-describedby'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

// Поле з підписом, підказкою й помилкою, пов'язаними через aria-describedby для екранних читачів.
export function TextField({ id, label, hint, error, ...inputProps }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <input
        {...inputProps}
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
