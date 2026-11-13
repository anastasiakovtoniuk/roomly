import { describe, expect, it } from 'vitest';
import { LoginBody, PASSWORD_MIN_LENGTH, RegisterBody } from '@roomly/shared';
import {
  collectFieldErrors,
  firstInvalidField,
  issuesToFields,
  readValidationFields,
} from '../../client/src/auth/fieldErrors';

// Клієнтська перевірка форм #11: ті самі схеми shared/, що й на сервері, і ті самі reason.
function clientErrors<V extends Record<string, string>>(
  schema: typeof RegisterBody | typeof LoginBody,
  values: V,
) {
  const parsed = schema.safeParse(values);
  if (parsed.success) return null;
  return collectFieldErrors(issuesToFields(parsed.error.issues), values as Record<keyof V & string, string>);
}

describe('Форми входу й реєстрації: помилки полів', () => {
  it('US-1.2-AC-01: порожня реєстрація показує помилку біля кожного поля', () => {
    const result = clientErrors(RegisterBody, { name: '  ', email: '', password: '' });
    expect(result).toEqual({
      complete: true,
      errors: { name: 'Вкажи імʼя.', email: 'Вкажи пошту.', password: 'Введи пароль.' },
    });
  });

  it('US-1.2-AC-01: некоректна пошта й короткий пароль мають окремі зрозумілі тексти', () => {
    const result = clientErrors(RegisterBody, { name: 'Оля', email: 'olia@', password: 'short' });
    expect(result?.errors).toEqual({
      email: 'Введи пошту у форматі name@example.com.',
      password: `Пароль має містити щонайменше ${PASSWORD_MIN_LENGTH} символів.`,
    });
  });

  it('US-1.2-AC-01: пароль понад 72 байти UTF-8 відхиляється ще на клієнті', () => {
    const result = clientErrors(RegisterBody, {
      name: 'Оля',
      email: 'olia@example.com',
      password: 'ж'.repeat(37),
    });
    expect(result?.errors.password).toMatch(/задовгий/);
  });

  it('US-1.2-AC-01: валідні дані проходять клієнтську перевірку з нормалізованою поштою', () => {
    const parsed = RegisterBody.safeParse({
      name: ' Оля ',
      email: ' Olia@Example.COM ',
      password: 'password1',
    });
    expect(parsed.success && parsed.data).toEqual({
      name: 'Оля',
      email: 'olia@example.com',
      password: 'password1',
    });
  });

  it('US-X.1a-AC-02: порожній пароль входу не розкриває правил довжини', () => {
    const result = clientErrors(LoginBody, { email: 'olia@example.com', password: '' });
    expect(result?.errors).toEqual({ password: 'Введи пароль.' });
    // Короткий непорожній пароль входу проходить до сервера: відмова лише INVALID_CREDENTIALS.
    expect(LoginBody.safeParse({ email: 'olia@example.com', password: 'x' }).success).toBe(true);
  });

  it('US-1.2-AC-01: details.fields сервера потрапляють до полів у порядку форми', () => {
    const values = { name: 'Оля', email: 'olia@', password: 'short' };
    const fields = readValidationFields({
      fields: [
        { path: 'password', reason: 'too_small' },
        { path: 'email', reason: 'invalid_format' },
      ],
    });
    const { errors, complete } = collectFieldErrors(fields, values);
    expect(complete).toBe(true);
    expect(firstInvalidField(['name', 'email', 'password'], errors)).toBe('email');
  });

  it('US-1.2-AC-01: помилка поза формою (тіло, Content-Type) не губиться, а йде в загальне повідомлення', () => {
    const values = { email: 'olia@example.com', password: 'password1' };
    expect(collectFieldErrors([{ path: 'body', reason: 'invalid_content_type' }], values).complete).toBe(
      false,
    );
    expect(collectFieldErrors([], values).complete).toBe(false);
  });

  it('US-1.2-AC-01: пошкоджені details.fields з мережі ігноруються без винятку', () => {
    expect(readValidationFields(undefined)).toEqual([]);
    expect(readValidationFields({ fields: 'email' })).toEqual([]);
    expect(
      readValidationFields({
        fields: [null, { path: 1, reason: 'x' }, { path: 'email', reason: 'too_big' }],
      }),
    ).toEqual([{ path: 'email', reason: 'too_big' }]);
  });
});
