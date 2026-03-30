import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Carrega TEST_DATABASE_URL do .env raiz do projeto (sem dependência dotenv)
const __dirname = dirname(fileURLToPath(import.meta.url));
let testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
try {
  const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
  const match = envContent.match(/^TEST_DATABASE_URL=(.+)$/m);
  if (match) testDbUrl = match[1].trim();
} catch { /* .env não encontrado — usa process.env */ }

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: testDbUrl },
    globalSetup: './src/tests/globalSetup.js',
    sequence: { concurrent: false },
    maxWorkers: 1,
    minWorkers: 1,
  },
});
