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
  submit: (body: B) => Promise<unknown>;
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
  const order = Object.keys(initialValues) as F[];

  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.target === 'form' ? alertRef.current : inputs.current[focusRequest.target];
    target?.focus();
  }, [focusRequest]);

  function showFieldErrors(errors: FieldErrors<F>) {
    setFieldErrors(errors);
    const first = firstInvalidField(order, errors);
    if (first) setFocusRequest({ target: first });
  }

  function showFailure(error: unknown) {
    if (error instanceof ApiError) {
      if (error.code === 'VALIDATION_ERROR') {
        const { errors, complete } = collectFieldErrors(readValidationFields(error.details), values);
        if (complete) {
          showFieldErrors(errors);
          return;
        }
      }
      const field = fieldForCode[error.code];
      if (field) {
        showFieldErrors({ [field]: getErrorMessage(error) } as FieldErrors<F>);
        return;
      }
    }
    setFormError(error);
    setFocusRequest({ target: 'form' });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setFormError(null);

    // Клієнтська перевірка лише для зручності: сервер перевіряє ту саму схему обов'язково.
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      showFieldErrors(collectFieldErrors(issuesToFields(parsed.error.issues), values).errors);
      return;
    }

    lock.current = true;
    setSubmitting(true);
    setFieldErrors({});
    try {
      await submit(parsed.data);
    } catch (error) {
      showFailure(error);
      return;
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
    onSuccess();
  }

  function field(name: F) {
    return {
      id: `auth-${name}`,
      name,
      value: values[name],
      error: fieldErrors[name],
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
