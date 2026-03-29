import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Garante que DATABASE_URL aponta para o banco de teste antes de qualquer import
 * de database.js no processo principal (globalSetup roda antes dos workers).
 */
function loadTestDatabaseUrl() {
  if (process.env.DATABASE_URL) return; // já setado via vitest.config.js env option
  try {
    const envContent = readFileSync(resolve(__dirname, '../../../.env'), 'utf-8');
    const match = envContent.match(/^TEST_DATABASE_URL=(.+)$/m);
    if (match) process.env.DATABASE_URL = match[1].trim();
  } catch { /* .env não encontrado */ }
}

export async function setup() {
  loadTestDatabaseUrl();
  const { initDb } = await import('../db/database.js');
  await initDb();
}

export async function teardown() {
  const { getPool } = await import('../db/database.js');
  await getPool().end();
}
