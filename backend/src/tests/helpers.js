import { resetDb, getDb } from '../db/database.js';

export function freshDb() {
  resetDb();
  return getDb();
}

const VALID_SETORES = ['Transporte Ambulância', 'Transporte Hemodiálise', 'Transporte Administrativo'];

/**
 * Creates an employee in the test database.
 * setor (or setores array) must be one of the valid setores.
 * Defaults to 'Transporte Ambulância' for backward compatibility.
 */
export function createEmployee(db, {
  name = 'Teste',
  setor = 'Transporte Ambulância',
  setores,
  preferredShiftId = null,
} = {}) {
  const empSetores = setores
    ? setores.filter((s) => VALID_SETORES.includes(s))
    : VALID_SETORES.includes(setor)
      ? [setor]
      : ['Transporte Ambulância'];

  const res = db
    .prepare('INSERT INTO employees (name, cargo) VALUES (?, ?)')
    .run(name, 'Motorista');
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(res.lastInsertRowid);

  for (const s of empSetores) {
    db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(emp.id, s);
  }

  db.prepare(
    'INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id) VALUES (?, 24, ?)'
  ).run(emp.id, preferredShiftId);

  return emp;
}

export function shiftId(db, name) {
  return db.prepare('SELECT id FROM shift_types WHERE name = ?').get(name)?.id;
}
