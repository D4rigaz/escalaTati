import { resetDb, getDb } from '../db/database.js';

export function freshDb() {
  resetDb();
  return getDb();
}

export function createEmployee(db, { name = 'Teste', cargo = 'Técnico', setor = 'TI' } = {}) {
  const res = db.prepare('INSERT INTO employees (name, cargo, setor) VALUES (?, ?, ?)').run(name, cargo, setor);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(res.lastInsertRowid);
  db.prepare(
    'INSERT INTO employee_rest_rules (employee_id, min_rest_hours, days_off_per_week) VALUES (?, 11, 1)'
  ).run(emp.id);
  return emp;
}

export function shiftId(db, name) {
  return db.prepare('SELECT id FROM shift_types WHERE name = ?').get(name)?.id;
}
