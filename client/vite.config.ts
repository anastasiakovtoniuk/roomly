import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig(({ mode }) => {
  // Один .env у корені репозиторію для клієнта й сервера (ADR-0007).
  const env = loadEnv(mode, repoRoot, '');
  const serverPort = env.SERVER_PORT ?? '3000';

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      port: Number(env.CLIENT_PORT ?? 5173),
      strictPort: true,
      // Клієнт і API на одному походженні: без CORS і окремого HTTPS для API (ADR-0002, ADR-0005).
      proxy: {
        '/api': `http://localhost:${serverPort}`,
      },
    },
  };
});
