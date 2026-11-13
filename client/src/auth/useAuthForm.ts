import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ErrorCode } from '@roomly/shared';
import { getErrorMessage } from '../api/errorMessages';
import { ApiError } from '../api/http';
import {
  collectFieldErrors,
  firstInvalidField,
  issuesToFields,
  readValidationFields,
  type AuthField,
  type FieldErrors,
} from './fieldErrors';

// Структурний тип safeParse схем Zod із shared/: клієнт не залежить від zod напряму.
type SafeParser<B> = {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: B }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; code: string }[] } };
};

type FocusRequest<F> = { target: F | 'form' };

export function useAuthForm<F extends AuthField, B>({
  initialValues,
  schema,
  submit,
  onSuccess,
  fieldForCode = {},
}: {
  initialValues: Record<F, string>;
  schema: SafeParser<B>;
  // Values форми теж приймаються: якщо клієнтська схема не прив'язала помилку до поля, вирішує сервер.
  submit: (body: B | Record<F, string>) => Promise<unknown>;
  onSuccess: () => void;
  // Коди відмови, які стосуються одного поля (наприклад, зайнята пошта), показуються біля нього.
  // NoInfer: набір полів визначають лише initialValues, а не цей перелік.
  fieldForCode?: Partial<Record<ErrorCode, NoInfer<F>>>;
}) {
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<F>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  // Новий об'єкт на кожну невдачу: повторна помилка в тому самому полі теж повертає фокус.
  const [focusRequest, setFocusRequest] = useState<FocusRequest<F> | null>(null);
  // Синхронний замок: Enter і клік до наступного render не надсилають другий запит.
  const lock = useRef(false);
  const inputs = useRef<Partial<Record<F, HTMLInputElement | null>>>({});
  const alertRef = useRef<HTMLDivElement>(null);
  // Пізня відповідь після переходу на інший екран не повинна його змінювати.
  const mounted = useRef(false);
  const order = Object.keys(initialValues) as F[];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.target === 'form' ? alertRef.current : inputs.current[focusRequest.target];
    target?.focus();
  }, [focusRequest]);

  // Фокус на першому полі з помилкою; якщо таких немає — на загальному повідомленні.
  function showErrors(errors: FieldErrors<F>, error: unknown = null) {
    setFieldErrors(errors);
    setFormError(error);
    const first = firstInvalidField(order, errors);
    if (first) setFocusRequest({ target: first });
    else if (error !== null) setFocusRequest({ target: 'form' });
  }

  // submitted — значення на момент відправки: поля під час запиту лише для читання.
  function showFailure(error: unknown, submitted: Record<F, string>) {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR') {
        const { errors, complete } = collectFieldErrors(readValidationFields(error.details), submitted);
        // Помилку поза полями форми не ховаємо: показуємо її разом із помилками полів.
        showErrors(errors, complete ? null : error);
        return;
      }
      const field = fieldForCode[error.code];
      if (field) {
        showErrors({ [field]: getErrorMessage(error) } as FieldErrors<F>);
        return;
      }
    }
    showErrors({}, error);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setFormError(null);

    // Клієнтська перевірка лише для зручності: сервер перевіряє ту саму схему обов'язково.
    const submitted = values;
    const parsed = schema.safeParse(submitted);
    if (!parsed.success) {
      const { errors } = collectFieldErrors(issuesToFields(parsed.error.issues), submitted);
      if (firstInvalidField(order, errors)) {
        showErrors(errors);
        return;
      }
    }

    lock.current = true;
    setSubmitting(true);
    setFieldErrors({});
    try {
      await submit(parsed.success ? parsed.data : submitted);
    } catch (error) {
      if (mounted.current) showFailure(error, submitted);
      return;
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
    if (mounted.current) onSuccess();
  }

  function field(name: F) {
    return {
      id: `auth-${name}`,
      name,
      value: values[name],
      error: fieldErrors[name],
      readOnly: submitting,
      ref: (element: HTMLInputElement | null) => {
        inputs.current[name] = element;
      },
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setValues((current) => ({ ...current, [name]: value }));
        // Виправлене поле більше не позначаємо як помилкове до наступної перевірки.
        setFieldErrors((current) => {
          if (current[name] === undefined) return current;
          const next = { ...current };
          delete next[name];
          return next;
        });
      },
    };
  }

  return { field, handleSubmit, submitting, formError, alertRef };
}
