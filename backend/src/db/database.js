import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'escala.db');

let db;

/** Reseta o singleton — use apenas em testes para obter um DB limpo. */
export function resetDb() {
  if (db) { try { db.close(); } catch {} }
  db = undefined;
}

export function getDb() {
  if (!db) {
    db = new DatabaseSync(process.env.DB_PATH || DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
    seedShiftTypes();
  }
  return db;
}

/** Run a function inside a transaction; rolls back on error. */
export function runTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cargo TEXT NOT NULL,
      setor TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shift_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_hours INTEGER NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee_rest_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      min_rest_hours INTEGER NOT NULL DEFAULT 11,
      days_off_per_week INTEGER NOT NULL DEFAULT 1,
      preferred_shift_id INTEGER REFERENCES shift_types(id),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      shift_type_id INTEGER REFERENCES shift_types(id),
      date TEXT NOT NULL,
      is_day_off INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS schedule_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      generated_at TEXT DEFAULT (datetime('now')),
      params_json TEXT
    );
  `);
}

function seedShiftTypes() {
  const count = db.prepare('SELECT COUNT(*) as c FROM shift_types').get();
  if (count.c > 0) return;

  runTransaction(() => {
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Manhã', '06:00', '12:00', 6, '#FCD34D');
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Tarde', '12:00', '18:00', 6, '#60A5FA');
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Noturno', '18:00', '06:00', 12, '#818CF8');
  });
}

export default getDb;
