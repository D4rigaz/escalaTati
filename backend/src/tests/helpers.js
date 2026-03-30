import { truncateAll, query, getPool } from '../db/database.js';

export async function freshDb() {
  await truncateAll();
}

export async function closePool() {
  await getPool().end();
}

const VALID_SETORES = ['Transporte Ambulância', 'Transporte Hemodiálise', 'Transporte Administrativo'];

/**
 * Creates an employee in the test database.
 * First param (_db) is ignored — kept for call-site compatibility.
 * setor (or setores array) must be one of the valid setores.
 * Defaults to 'Transporte Ambulância' for backward compatibility.
 */
export async function createEmployee(_db, {
  name = 'Teste',
  setor = 'Transporte Ambulância',
  setores,
  preferredShiftId = null,
  work_schedule = 'dom_sab',
  cycle_start_month = 1,
  cycle_start_year = 2026,
} = {}) {
  const empSetores = setores
    ? setores.filter((s) => VALID_SETORES.includes(s))
    : VALID_SETORES.includes(setor)
      ? [setor]
      : ['Transporte Ambulância'];

  const { rows } = await query(
    'INSERT INTO employees (name, cargo, work_schedule, cycle_start_month, cycle_start_year) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, 'Motorista', work_schedule, cycle_start_month, cycle_start_year]
  );
  const emp = rows[0];

  for (const s of empSetores) {
    await query(
      'INSERT INTO employee_sectors (employee_id, setor) VALUES ($1, $2)',
      [emp.id, s]
    );
  }

  await query(
    'INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id) VALUES ($1, 24, $2)',
    [emp.id, preferredShiftId]
  );

  return emp;
}

export async function shiftId(_db, name) {
  const { rows } = await query('SELECT id FROM shift_types WHERE name = $1', [name]);
  return rows[0]?.id;
}
