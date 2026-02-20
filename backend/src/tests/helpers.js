import { resetDb, getDb } from '../db/database.js';

/** Reseta o banco e retorna uma instância limpa com seed aplicado. */
export function freshDb() {
  resetDb();
  return getDb(); // recria :memory: com schema + seed dos shift_types
}

/** Cria um funcionário via banco direto e retorna o objeto completo. */
export function createEmployee(db, { name = 'Teste', cargo = 'Técnico', setor = 'TI' } = {}) {
  const res = db.prepare('INSERT INTO employees (name, cargo, setor) VALUES (?, ?, ?)').run(name, cargo, setor);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(res.lastInsertRowid);
  db.prepare(
    'INSERT INTO employee_rest_rules (employee_id, min_rest_hours, days_off_per_week) VALUES (?, 11, 1)'
  ).run(emp.id);
  return emp;
}

/** Retorna o id do shift_type pelo nome. */
export function shiftId(db, name) {
  return db.prepare('SELECT id FROM shift_types WHERE name = ?').get(name)?.id;
}
