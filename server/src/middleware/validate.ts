import type { Request, RequestHandler } from 'express';
import type { ZodType, z } from 'zod';
import type { ValidationFieldError } from '@roomly/shared';
import { AppError } from '../lib/appError';

const REQUEST_PARTS = ['params', 'query', 'body'] as const;
type RequestPart = (typeof REQUEST_PARTS)[number];

export type RequestSchemas = Partial<Record<RequestPart, ZodType>>;

// Шлях поля за error_format.md §1: поля тіла без префікса (`email`, `equipment.1`),
// параметри шляху й запиту — з префіксом (`params.roomId`, `query.date`).
// Причина — код Zod як є (`too_small`, `invalid_format`, …).
function toFieldErrors(part: RequestPart, issues: z.core.$ZodIssue[]): ValidationFieldError[] {
  return issues.map((issue) => {
    const segments = issue.path.map(String);
    const path = part === 'body' ? segments : [part, ...segments];
    return { path: path.length > 0 ? path.join('.') : part, reason: issue.code };
  });
}

// Перевіряє вхід схемами Zod із shared/ (ADR-0003). Невдача будь-якої частини — 400 VALIDATION_ERROR
// з усіма полями разом; успіх — обробник отримує вже нормалізовані дані.
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const fields: ValidationFieldError[] = [];
    const parsed: Partial<Record<RequestPart, unknown>> = {};

    for (const part of REQUEST_PARTS) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        parsed[part] = result.data;
      } else {
        fields.push(...toFieldErrors(part, result.error.issues));
      }
    }

    if (fields.length > 0) {
      next(new AppError('VALIDATION_ERROR', 'Некоректні дані запиту', { fields }));
      return;
    }

    if ('params' in parsed) req.params = parsed.params as Request['params'];
    if ('body' in parsed) req.body = parsed.body;
    // У Express 5 req.query — геттер без сетера, тому значення перевизначається на самому запиті.
    if ('query' in parsed) {
      Object.defineProperty(req, 'query', {
        value: parsed.query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
