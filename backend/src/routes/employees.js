import { Router } from 'express';
import { getDb, runTransaction } from '../db/database.js';

const router = Router();

// GET /api/employees
router.get('/', (req, res) => {
  const db = getDb();
  const includeInactive = req.query.includeInactive === 'true';
  const employees = includeInactive
    ? db.prepare('SELECT * FROM employees ORDER BY name').all()
    : db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();

  const rules = db.prepare('SELECT * FROM employee_rest_rules').all();
  const rulesByEmployee = {};
  for (const rule of rules) {
    rulesByEmployee[rule.employee_id] = rule;
  }

  const result = employees.map((e) => ({ ...e, restRules: rulesByEmployee[e.id] || null }));
  res.json(result);
});

// GET /api/employees/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const restRules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(req.params.id);
  res.json({ ...employee, restRules: restRules || null });
});

// POST /api/employees
router.post('/', (req, res) => {
  const db = getDb();
  const { name, cargo, setor, restRules } = req.body;

  if (!name || !cargo || !setor) {
    return res.status(400).json({ error: 'name, cargo, and setor are required' });
  }

  const employee = runTransaction(() => {
    const result = db
      .prepare('INSERT INTO employees (name, cargo, setor) VALUES (?, ?, ?)')
      .run(name.trim(), cargo.trim(), setor.trim());

    const employeeId = result.lastInsertRowid;

    db.prepare(
      `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, days_off_per_week, preferred_shift_id, notes)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      employeeId,
      restRules?.min_rest_hours ?? 11,
      restRules?.days_off_per_week ?? 1,
      restRules?.preferred_shift_id ?? null,
      restRules?.notes ?? null
    );

    return db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  });

  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id);
  res.status(201).json({ ...employee, restRules: rules });
});

// PUT /api/employees/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, cargo, setor, active, restRules } = req.body;
  const id = parseInt(req.params.id);

  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  runTransaction(() => {
    // Update each field only if provided
    if (name !== undefined) db.prepare("UPDATE employees SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
    if (cargo !== undefined) db.prepare("UPDATE employees SET cargo = ?, updated_at = datetime('now') WHERE id = ?").run(cargo, id);
    if (setor !== undefined) db.prepare("UPDATE employees SET setor = ?, updated_at = datetime('now') WHERE id = ?").run(setor, id);
    if (active !== undefined) db.prepare("UPDATE employees SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, id);

    if (restRules) {
      const existing = db
        .prepare('SELECT id FROM employee_rest_rules WHERE employee_id = ?')
        .get(id);
      if (existing) {
        if (restRules.min_rest_hours !== undefined)
          db.prepare('UPDATE employee_rest_rules SET min_rest_hours = ? WHERE employee_id = ?').run(restRules.min_rest_hours, id);
        if (restRules.days_off_per_week !== undefined)
          db.prepare('UPDATE employee_rest_rules SET days_off_per_week = ? WHERE employee_id = ?').run(restRules.days_off_per_week, id);
        if (restRules.preferred_shift_id !== undefined)
          db.prepare('UPDATE employee_rest_rules SET preferred_shift_id = ? WHERE employee_id = ?').run(restRules.preferred_shift_id, id);
        if (restRules.notes !== undefined)
          db.prepare('UPDATE employee_rest_rules SET notes = ? WHERE employee_id = ?').run(restRules.notes, id);
      } else {
        db.prepare(
          `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, days_off_per_week, preferred_shift_id, notes)
           VALUES (?, ?, ?, ?, ?)`
        ).run(
          id,
          restRules.min_rest_hours ?? 11,
          restRules.days_off_per_week ?? 1,
          restRules.preferred_shift_id ?? null,
          restRules.notes ?? null
        );
      }
    }
  });

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(id);
  res.json({ ...updated, restRules: rules });
});

// DELETE /api/employees/:id (soft delete)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  db.prepare("UPDATE employees SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ success: true });
});

export default router;
