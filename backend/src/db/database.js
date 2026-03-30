import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

/** Atalho para queries simples */
export async function query(sql, params = []) {
  return getPool().query(sql, params);
}

/** Executa fn(client) dentro de uma transaction. Rollback automático em erro. */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Para testes: trunca tabelas mutáveis e reinicia sequences. shift_types é preservada (seeded em globalSetup). */
export async function truncateAll() {
  await query(`
    TRUNCATE schedule_entries, schedule_generations,
             employee_vacations, employee_rest_rules,
             employee_sectors, employees
    RESTART IDENTITY CASCADE
  `);
}

/** Inicializa schema + seed na startup */
export async function initDb() {
  await initSchema();
  await seedShiftTypes();
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cargo TEXT NOT NULL,
      work_schedule TEXT NOT NULL DEFAULT 'dom_sab',
      color TEXT NOT NULL DEFAULT '#6B7280',
      cycle_start_month INTEGER NOT NULL DEFAULT 1,
      cycle_start_year INTEGER NOT NULL DEFAULT 2026,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS employee_sectors (
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      setor TEXT NOT NULL,
      PRIMARY KEY (employee_id, setor)
    );

    CREATE TABLE IF NOT EXISTS employee_vacations (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shift_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_hours INTEGER NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee_rest_rules (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      min_rest_hours INTEGER NOT NULL DEFAULT 11,
      preferred_shift_id INTEGER REFERENCES shift_types(id),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_entries (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      shift_type_id INTEGER REFERENCES shift_types(id),
      date TEXT NOT NULL,
      is_day_off BOOLEAN NOT NULL DEFAULT FALSE,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      setor_override TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS schedule_generations (
      id SERIAL PRIMARY KEY,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      params_json TEXT
    );
  `);
}

async function seedShiftTypes() {
  await query(`
    INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES
      ('Diurno',  '07:00', '19:00', 12, '#34D399'),
      ('Noturno', '19:00', '07:00', 12, '#818CF8'),
      ('Manhã',   '07:00', '13:00',  6, '#FCD34D'),
      ('Tarde',   '13:00', '19:00',  6, '#F97316')
    ON CONFLICT (name) DO UPDATE SET
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      duration_hours = EXCLUDED.duration_hours,
      color = EXCLUDED.color;
  `);
}

export default getPool;
