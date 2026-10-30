// Ідемпотентний seed адміністратора (data_model.md §8, TA-2, SYS-AC-08).
// Пароль береться лише із середовища; наявного адміністратора seed не змінює.
import bcrypt from 'bcryptjs';
import { PASSWORD_MIN_LENGTH } from '@roomly/shared';
import { prisma } from '../src/db/prisma';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Змінна ${name} не задана. Перевірте .env у корені репозиторію (шаблон — .env.example).`);
  }
  return value;
}

async function main() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  const name = requireEnv('ADMIN_NAME');

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_PASSWORD має містити щонайменше ${PASSWORD_MIN_LENGTH} символів.`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: користувач ${email} уже існує, без змін.`);
    return;
  }

  await prisma.user.create({
    data: { email, name, role: 'admin', passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`Seed: створено адміністратора ${email}.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
