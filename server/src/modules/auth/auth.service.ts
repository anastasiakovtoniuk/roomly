import bcrypt from 'bcryptjs';
import { USER_ROLES, type LoginBody, type RegisterBody, type User, type UserRole } from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/appError';
import { generateSessionToken, hashSessionToken } from './session';

// Та сама вартість, що й у seed адміністратора.
const BCRYPT_ROUNDS = 10;

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthResult {
  user: User;
  token: string;
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

// Назовні — лише поля User з api_spec.md §2; passwordHash і сесії не повертаються ніколи.
function toApiUser(record: UserRecord): User {
  if (!isUserRole(record.role)) {
    throw new Error(`Невідома роль користувача ${record.id}: ${record.role}`);
  }
  return { id: record.id, name: record.name, email: record.email, role: record.role };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// Нова сесія пристрою замінює попередню: старий рядок видаляється, а не лишається дійсним
// після перезапису cookie (US-X.1b-AC-03).
async function startSession(userId: string, previousToken: string | undefined): Promise<string> {
  const token = generateSessionToken();
  await prisma.$transaction([
    ...(previousToken
      ? [prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(previousToken) } })]
      : []),
    prisma.session.create({ data: { tokenHash: hashSessionToken(token), userId } }),
  ]);
  return token;
}

// US-1.2: роль завжди student (BR-14, FB-14) — поля role у RegisterBody немає взагалі.
// Q08: автоматичний вхід після реєстрації — [Пропозиція] з api_spec.md §5.
export async function register(input: RegisterBody, previousToken: string | undefined): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  let record: UserRecord;
  try {
    record = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: 'student' },
    });
  } catch (err) {
    // Унікальний індекс пошти ловить і паралельну реєстрацію, яку попередня перевірка пропустила б.
    if (isUniqueViolation(err)) {
      throw new AppError('EMAIL_ALREADY_REGISTERED', 'Цю пошту вже зареєстровано');
    }
    throw err;
  }

  const token = await startSession(record.id, previousToken);
  return { user: toApiUser(record), token };
}

// Хеш для порівняння, коли пошти немає: час відповіді не має видавати, чи існує акаунт.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('roomly-dummy-password', BCRYPT_ROUNDS);
  return dummyHash;
}

// US-X.1a: однакова відповідь INVALID_CREDENTIALS для неіснуючої пошти й хибного пароля.
export async function login(input: LoginBody, previousToken: string | undefined): Promise<AuthResult> {
  const record = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordMatches = await bcrypt.compare(
    input.password,
    record?.passwordHash ?? (await getDummyHash()),
  );

  if (!record || !passwordMatches) {
    throw new AppError('INVALID_CREDENTIALS', 'Неправильна пошта або пароль');
  }

  const token = await startSession(record.id, previousToken);
  return { user: toApiUser(record), token };
}

// US-X.1b: видаляє сесію; без дійсної сесії — нічого не робить (ідемпотентно).
export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

// Користувач сесії — єдине джерело ідентифікатора й ролі (BR-17, FB-11).
export async function findSessionUser(token: string): Promise<User | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return session ? toApiUser(session.user) : null;
}
