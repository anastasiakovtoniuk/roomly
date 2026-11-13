import { PASSWORD_MIN_LENGTH, type ValidationFieldError } from '@roomly/shared';

// Поля форм входу й реєстрації — назви з RegisterBody/LoginBody у shared/.
export type AuthField = 'name' | 'email' | 'password';
export type FieldErrors<F extends AuthField> = Partial<Record<F, string>>;

const REQUIRED: Record<AuthField, string> = {
  name: 'Вкажи імʼя.',
  email: 'Вкажи пошту.',
  password: 'Введи пароль.',
};

function isEmpty(field: AuthField, value: string): boolean {
  // Пароль не обрізається схемою, тому пробіли в ньому — уже введене значення.
  return field === 'password' ? value === '' : value.trim() === '';
}

// Текст біля поля обирається за reason (код Zod, error_format.md §1), а не за message сервера.
// Порожнє поле має окремий текст: «закоротке» для порожнього пароля входу розкривало б правила.
export function fieldMessage(field: AuthField, reason: string, value: string): string {
  if (isEmpty(field, value)) return REQUIRED[field];
  switch (field) {
    case 'name':
      return reason === 'too_big' ? 'Імʼя задовге. Скороти його.' : 'Перевір імʼя.';
    case 'email':
      return reason === 'too_big' ? 'Пошта задовга.' : 'Введи пошту у форматі name@example.com.';
    case 'password':
      if (reason === 'too_small') return `Пароль має містити щонайменше ${PASSWORD_MIN_LENGTH} символів.`;
      // Межа рахується в байтах UTF-8 (Q08): про кирилицю згадуємо лише тоді, коли вона є в паролі.
      if (reason === 'too_big') {
        return [...value].some((char) => (char.codePointAt(0) ?? 0) > 0x7f)
          ? 'Пароль задовгий. Скороти його: літери кирилиці займають удвічі більше місця, ніж латиниця.'
          : 'Пароль задовгий. Скороти його.';
      }
      return 'Перевір пароль.';
  }
}

// Перетворює помилки полів (з клієнтської схеми чи details.fields сервера) на тексти біля полів.
// complete = false, якщо є помилка поза формою: тоді показуємо загальне повідомлення, а не ховаємо її.
export function collectFieldErrors<F extends AuthField>(
  issues: readonly ValidationFieldError[],
  values: Record<F, string>,
): { errors: FieldErrors<F>; complete: boolean } {
  const errors: FieldErrors<F> = {};
  let complete = issues.length > 0;
  for (const { path, reason } of issues) {
    if (!Object.hasOwn(values, path)) {
      complete = false;
      continue;
    }
    const field = path as F;
    errors[field] ??= fieldMessage(field, reason, values[field]);
  }
  return { errors, complete };
}

// Помилки клієнтської перевірки Zod у тому самому вигляді, що й details.fields сервера;
// порожній шлях (перевірка всього об'єкта) — `body`, як у error_format.md §1.
export function issuesToFields(
  issues: readonly { path: readonly PropertyKey[]; code: string }[],
): ValidationFieldError[] {
  return issues.map((issue) => ({ path: issue.path.map(String).join('.') || 'body', reason: issue.code }));
}

// details приходить із мережі, тому структуру перевіряємо, а не приводимо типом.
export function readValidationFields(details: Record<string, unknown> | undefined): ValidationFieldError[] {
  const fields = details?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (item): item is ValidationFieldError =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).path === 'string' &&
      typeof (item as Record<string, unknown>).reason === 'string',
  );
}

export function firstInvalidField<F extends AuthField>(
  order: readonly F[],
  errors: FieldErrors<F>,
): F | undefined {
  return order.find((field) => errors[field] !== undefined);
}
