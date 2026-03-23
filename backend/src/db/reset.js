/**
 * db:reset — apaga o banco de desenvolvimento e o recria do zero.
 * Use apenas em ambiente de desenvolvimento. NUNCA em produção.
 *
 * Uso: npm run db:reset
 */

import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'escala.db');

if (DB_PATH === ':memory:') {
  console.log('DB_PATH=:memory: — nada a apagar.');
  process.exit(0);
}

console.log('⚠️  ATENÇÃO: este script apaga permanentemente o banco de desenvolvimento.');
console.log('   Arquivo:', DB_PATH);
console.log('');

if (!existsSync(DB_PATH)) {
  console.log('Banco não encontrado — nada a fazer.');
  process.exit(0);
}

rmSync(DB_PATH);
console.log('Banco apagado com sucesso.');
console.log('Execute "npm run db:seed" para popular com dados representativos,');
console.log('ou "npm run dev" para iniciar com banco vazio.');
