import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Окрема тестова база, створена наявними міграціями (ADR-0008); робоча dev.db не зачіпається.
export default function setup() {
  rmSync(path.join(serverDir, 'prisma', 'test.db'), { force: true });
  execSync('npx prisma migrate deploy', { cwd: serverDir, stdio: 'ignore', env: process.env });
}
