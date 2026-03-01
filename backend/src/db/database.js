import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'escala.db');

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(process.env.DB_PATH || DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
    seedShiftTypes();
    runMigrations();
    migrateShiftTimes();
  }
  return db;
}

/** Reseta o singleton — use apenas em testes para obter um DB limpo. */
export function resetDb() {
  if (db) { try { db.close(); } catch {} }
  db = undefined;
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
      work_schedule TEXT NOT NULL DEFAULT 'dom_sab',
      color TEXT NOT NULL DEFAULT '#6B7280',
      cycle_month INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employee_sectors (
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      setor TEXT NOT NULL,
      PRIMARY KEY (employee_id, setor)
    );

    CREATE TABLE IF NOT EXISTS employee_vacations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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
      setor_override TEXT,
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

/**
 * Handles schema upgrades for existing databases.
 * Uses PRAGMA table_info to detect which migrations are needed.
 * Safe to run on fresh DBs — each migration checks before applying.
 */
function runMigrations() {
  const empCols  = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
  const restCols = db.prepare('PRAGMA table_info(employee_rest_rules)').all().map((c) => c.name);
  const entryCols = db.prepare('PRAGMA table_info(schedule_entries)').all().map((c) => c.name);

  // Add work_schedule to employees (old DBs)
  if (!empCols.includes('work_schedule')) {
    db.exec("ALTER TABLE employees ADD COLUMN work_schedule TEXT NOT NULL DEFAULT 'dom_sab'");
  }

  // Add color to employees (old DBs)
  if (!empCols.includes('color')) {
    db.exec("ALTER TABLE employees ADD COLUMN color TEXT NOT NULL DEFAULT '#6B7280'");
  }

  // Add cycle_month to employees (Issue #41)
  if (!empCols.includes('cycle_month')) {
    db.exec('ALTER TABLE employees ADD COLUMN cycle_month INTEGER NOT NULL DEFAULT 1');
  }

  // Migrate setor column → employee_sectors table
  if (empCols.includes('setor')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_sectors (
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        setor TEXT NOT NULL,
        PRIMARY KEY (employee_id, setor)
      )
    `);
    db.exec(`
      INSERT OR IGNORE INTO employee_sectors (employee_id, setor)
      SELECT id, setor FROM employees WHERE setor IS NOT NULL AND setor != ''
    `);
    db.exec('ALTER TABLE employees DROP COLUMN setor');
  }

  // Remove days_off_per_week from employee_rest_rules (old DBs)
  if (restCols.includes('days_off_per_week')) {
    db.exec('ALTER TABLE employee_rest_rules DROP COLUMN days_off_per_week');
  }

  // Add setor_override to schedule_entries (old DBs)
  if (!entryCols.includes('setor_override')) {
    db.exec('ALTER TABLE schedule_entries ADD COLUMN setor_override TEXT');
  }
}

function seedShiftTypes() {
  const count = db.prepare('SELECT COUNT(*) as c FROM shift_types').get();
  if (count.c > 0) return;

  runTransaction(() => {
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Diurno',  '07:00', '19:00', 12, '#34D399');
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Noturno', '19:00', '07:00', 12, '#818CF8');
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Manhã',   '07:00', '13:00',  6, '#FCD34D');
    db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
    ).run('Tarde',   '13:00', '19:00',  6, '#F97316');
  });
}

function migrateShiftTimes() {
  runTransaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?,?,?,?,?)"
    ).run('Diurno', '07:00', '19:00', 12, '#34D399');
    db.prepare("UPDATE shift_types SET start_time=?, end_time=?, duration_hours=? WHERE name=?")
      .run('07:00', '19:00', 12, 'Diurno');
    db.prepare(
      "INSERT OR IGNORE INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?,?,?,?,?)"
    ).run('Noturno', '19:00', '07:00', 12, '#818CF8');
    db.prepare("UPDATE shift_types SET start_time=?, end_time=?, duration_hours=? WHERE name=?")
      .run('19:00', '07:00', 12, 'Noturno');
    db.prepare(
      "INSERT OR IGNORE INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?,?,?,?,?)"
    ).run('Manhã', '07:00', '13:00', 6, '#FCD34D');
    db.prepare("UPDATE shift_types SET start_time=?, end_time=?, duration_hours=? WHERE name=?")
      .run('07:00', '13:00', 6, 'Manhã');
    db.prepare(
      "INSERT OR IGNORE INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?,?,?,?,?)"
    ).run('Tarde', '13:00', '19:00', 6, '#F97316');
    db.prepare("UPDATE shift_types SET start_time=?, end_time=?, duration_hours=? WHERE name=?")
      .run('13:00', '19:00', 6, 'Tarde');
  });
}

export default getDb;
