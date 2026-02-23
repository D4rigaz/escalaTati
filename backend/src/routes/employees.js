import { Router } from 'express';
import { getDb, runTransaction } from '../db/database.js';

const router = Router();

const SETORES_VALIDOS = [
  'Transporte Ambulância',
  'Transporte Hemodiálise',
  'Transporte Administrativo',
];

const WORK_SCHEDULES_VALIDOS = ['seg_sex', 'dom_sab'];
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

/** Rejeita datas com componentes inválidos (ex: 2025-02-30 rola para março no V8). */
function isValidCalendarDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

/** Validate setores array. Returns error string or null. */
function validateSetores(setores) {
  if (!Array.isArray(setores) || setores.length === 0) {
    return 'setores deve ser um array não vazio';
  }
  for (const s of setores) {
    if (!SETORES_VALIDOS.includes(s)) return `Setor inválido: ${s}`;
  }
  if (setores.includes('Transporte Administrativo') && setores.length > 1) {
    return 'Transporte Administrativo é exclusivo — não pode ser combinado com outros setores';
  }
  return null;
}

/** Load setores for a single employee. */
function loadSetores(db, employeeId) {
  return db
    .prepare('SELECT setor FROM employee_sectors WHERE employee_id = ? ORDER BY setor')
    .all(employeeId)
    .map((r) => r.setor);
}

/** Load vacations for a single employee. */
function loadVacations(db, employeeId) {
  return db
    .prepare('SELECT * FROM employee_vacations WHERE employee_id = ? ORDER BY start_date')
    .all(employeeId);
}

// ── GET /api/employees ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const includeInactive = req.query.includeInactive === 'true';
  const employees = includeInactive
    ? db.prepare('SELECT * FROM employees ORDER BY name').all()
    : db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();

  const rules = db.prepare('SELECT * FROM employee_rest_rules').all();
  const rulesByEmployee = {};
  for (const rule of rules) rulesByEmployee[rule.employee_id] = rule;

  // Load all sectors in one query
  const allSectors = db.prepare('SELECT employee_id, setor FROM employee_sectors').all();
  const sectorsByEmployee = {};
  for (const s of allSectors) {
    if (!sectorsByEmployee[s.employee_id]) sectorsByEmployee[s.employee_id] = [];
    sectorsByEmployee[s.employee_id].push(s.setor);
  }

  // Load all vacations in one query
  const allVacations = db
    .prepare('SELECT * FROM employee_vacations ORDER BY start_date')
    .all();
  const vacationsByEmployee = {};
  for (const v of allVacations) {
    if (!vacationsByEmployee[v.employee_id]) vacationsByEmployee[v.employee_id] = [];
    vacationsByEmployee[v.employee_id].push(v);
  }

  const result = employees.map((e) => ({
    ...e,
    setores: sectorsByEmployee[e.id] || [],
    vacations: vacationsByEmployee[e.id] || [],
    restRules: rulesByEmployee[e.id] || null,
  }));
  res.json(result);
});

// ── GET /api/employees/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const restRules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(req.params.id);
  const setores = loadSetores(db, employee.id);
  const vacations = loadVacations(db, employee.id);

  res.json({ ...employee, setores, vacations, restRules: restRules || null });
});

// ── POST /api/employees ───────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const db = getDb();
  const { name, setores, work_schedule = 'dom_sab', color = '#6B7280', restRules } = req.body;

  if (!name) return res.status(400).json({ error: 'name é obrigatório' });

  const setoresErr = validateSetores(setores);
  if (setoresErr) return res.status(400).json({ error: setoresErr });

  if (!WORK_SCHEDULES_VALIDOS.includes(work_schedule)) {
    return res.status(400).json({ error: 'work_schedule deve ser seg_sex ou dom_sab' });
  }

  if (!COLOR_REGEX.test(color)) {
    return res.status(400).json({ error: 'color deve ser um hex válido (#RRGGBB)' });
  }

  const employee = runTransaction(() => {
    const result = db
      .prepare('INSERT INTO employees (name, cargo, work_schedule, color) VALUES (?, ?, ?, ?)')
      .run(name.trim(), 'Motorista', work_schedule, color);

    const employeeId = result.lastInsertRowid;

    for (const setor of setores) {
      db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(employeeId, setor);
    }

    db.prepare(
      `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id, notes)
       VALUES (?, ?, ?, ?)`
    ).run(
      employeeId,
      24,
      restRules?.preferred_shift_id ?? null,
      restRules?.notes ?? null
    );

    return db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  });

  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id);
  const empSetores = loadSetores(db, employee.id);
  res.status(201).json({ ...employee, setores: empSetores, vacations: [], restRules: rules });
});

// ── PUT /api/employees/:id ────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, setores, work_schedule, color, active, restRules } = req.body;
  const id = parseInt(req.params.id);

  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  if (setores !== undefined) {
    const setoresErr = validateSetores(setores);
    if (setoresErr) return res.status(400).json({ error: setoresErr });
  }

  if (work_schedule !== undefined && !WORK_SCHEDULES_VALIDOS.includes(work_schedule)) {
    return res.status(400).json({ error: 'work_schedule deve ser seg_sex ou dom_sab' });
  }

  if (color !== undefined && !COLOR_REGEX.test(color)) {
    return res.status(400).json({ error: 'color deve ser um hex válido (#RRGGBB)' });
  }

  runTransaction(() => {
    if (name !== undefined)
      db.prepare("UPDATE employees SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
    db.prepare("UPDATE employees SET cargo = 'Motorista', updated_at = datetime('now') WHERE id = ?").run(id);
    if (work_schedule !== undefined)
      db.prepare("UPDATE employees SET work_schedule = ?, updated_at = datetime('now') WHERE id = ?").run(work_schedule, id);
    if (color !== undefined)
      db.prepare("UPDATE employees SET color = ?, updated_at = datetime('now') WHERE id = ?").run(color, id);
    if (active !== undefined)
      db.prepare("UPDATE employees SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, id);

    if (setores !== undefined) {
      db.prepare('DELETE FROM employee_sectors WHERE employee_id = ?').run(id);
      for (const setor of setores) {
        db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(id, setor);
      }
    }

    if (restRules) {
      const existing = db
        .prepare('SELECT id FROM employee_rest_rules WHERE employee_id = ?')
        .get(id);
      if (existing) {
        if (restRules.preferred_shift_id !== undefined)
          db.prepare('UPDATE employee_rest_rules SET preferred_shift_id = ? WHERE employee_id = ?').run(restRules.preferred_shift_id, id);
        if (restRules.notes !== undefined)
          db.prepare('UPDATE employee_rest_rules SET notes = ? WHERE employee_id = ?').run(restRules.notes, id);
      } else {
        db.prepare(
          `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id, notes)
           VALUES (?, ?, ?, ?)`
        ).run(id, 24, restRules.preferred_shift_id ?? null, restRules.notes ?? null);
      }
    }
  });

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(id);
  const empSetores = loadSetores(db, id);
  const empVacations = loadVacations(db, id);
  res.json({ ...updated, setores: empSetores, vacations: empVacations, restRules: rules });
});

// ── DELETE /api/employees/:id (soft delete) ───────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  db.prepare("UPDATE employees SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ success: true });
});

// ── GET /api/employees/:id/vacations ─────────────────────────────────────────
router.get('/:id/vacations', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  res.json(loadVacations(db, id));
});

// ── POST /api/employees/:id/vacations ────────────────────────────────────────
router.post('/:id/vacations', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { start_date, end_date, notes } = req.body;

  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date e end_date são obrigatórios' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
  }
  if (!isValidCalendarDate(start_date) || !isValidCalendarDate(end_date)) {
    return res.status(400).json({ error: 'Datas inválidas (ex: 2025-02-30 não existe)' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'end_date deve ser >= start_date' });
  }

  const result = db
    .prepare(
      'INSERT INTO employee_vacations (employee_id, start_date, end_date, notes) VALUES (?, ?, ?, ?)'
    )
    .run(id, start_date, end_date, notes ?? null);

  const vacation = db
    .prepare('SELECT * FROM employee_vacations WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json(vacation);
});

// ── PUT /api/employees/:id/vacations/:vid ─────────────────────────────────────
router.put('/:id/vacations/:vid', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const vid = parseInt(req.params.vid);
  const { start_date, end_date, notes } = req.body;

  const vacation = db
    .prepare('SELECT * FROM employee_vacations WHERE id = ? AND employee_id = ?')
    .get(vid, id);
  if (!vacation) return res.status(404).json({ error: 'Vacation not found' });

  const newStart = start_date ?? vacation.start_date;
  const newEnd = end_date ?? vacation.end_date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newStart) || !/^\d{4}-\d{2}-\d{2}$/.test(newEnd)) {
    return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
  }
  if (!isValidCalendarDate(newStart) || !isValidCalendarDate(newEnd)) {
    return res.status(400).json({ error: 'Datas inválidas (ex: 2025-02-30 não existe)' });
  }
  if (newEnd < newStart) {
    return res.status(400).json({ error: 'end_date deve ser >= start_date' });
  }

  db.prepare(
    'UPDATE employee_vacations SET start_date = ?, end_date = ?, notes = ? WHERE id = ?'
  ).run(newStart, newEnd, notes ?? vacation.notes, vid);

  const updated = db.prepare('SELECT * FROM employee_vacations WHERE id = ?').get(vid);
  res.json(updated);
});

// ── DELETE /api/employees/:id/vacations/:vid ──────────────────────────────────
router.delete('/:id/vacations/:vid', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const vid = parseInt(req.params.vid);

  const vacation = db
    .prepare('SELECT id FROM employee_vacations WHERE id = ? AND employee_id = ?')
    .get(vid, id);
  if (!vacation) return res.status(404).json({ error: 'Vacation not found' });

  db.prepare('DELETE FROM employee_vacations WHERE id = ?').run(vid);
  res.json({ success: true });
});

export default router;
