import { Router } from 'express';
import { query, transaction } from '../db/database.js';

const router = Router();

const SETORES_VALIDOS = [
  'Transporte Ambulância',
  'Transporte Hemodiálise',
  'Transporte Administrativo',
];

const WORK_SCHEDULES_VALIDOS = ['seg_sex', 'dom_sab'];
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const MIN_CYCLE_START_YEAR = 2020;

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
async function loadSetores(employeeId) {
  const result = await query(
    'SELECT setor FROM employee_sectors WHERE employee_id = $1 ORDER BY setor',
    [employeeId]
  );
  return result.rows.map((r) => r.setor);
}

/** Load vacations for a single employee. */
async function loadVacations(employeeId) {
  const result = await query(
    'SELECT * FROM employee_vacations WHERE employee_id = $1 ORDER BY start_date',
    [employeeId]
  );
  return result.rows;
}

// ── GET /api/employees ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const employees = includeInactive
    ? (await query('SELECT * FROM employees ORDER BY name')).rows
    : (await query('SELECT * FROM employees WHERE active = TRUE ORDER BY name')).rows;

  const rules = (await query('SELECT * FROM employee_rest_rules')).rows;
  const rulesByEmployee = {};
  for (const rule of rules) rulesByEmployee[rule.employee_id] = rule;

  // Load all sectors in one query
  const allSectors = (await query('SELECT employee_id, setor FROM employee_sectors')).rows;
  const sectorsByEmployee = {};
  for (const s of allSectors) {
    if (!sectorsByEmployee[s.employee_id]) sectorsByEmployee[s.employee_id] = [];
    sectorsByEmployee[s.employee_id].push(s.setor);
  }

  // Load all vacations in one query
  const allVacations = (await query('SELECT * FROM employee_vacations ORDER BY start_date')).rows;
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
router.get('/:id', async (req, res) => {
  const employee = (await query('SELECT * FROM employees WHERE id = $1', [req.params.id])).rows[0];
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const restRules = (await query(
    'SELECT * FROM employee_rest_rules WHERE employee_id = $1',
    [req.params.id]
  )).rows[0];
  const setores = await loadSetores(employee.id);
  const vacations = await loadVacations(employee.id);

  res.json({ ...employee, setores, vacations, restRules: restRules || null });
});

// ── POST /api/employees ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, setores, work_schedule = 'dom_sab', color = '#6B7280', cycle_start_month, cycle_start_year, restRules } = req.body;
  // null ou ausente → usar defaults
  const effectiveCycleStartMonth = cycle_start_month ?? 1;
  const effectiveCycleStartYear  = cycle_start_year  ?? 2026;

  if (!name) return res.status(400).json({ error: 'name é obrigatório' });

  const setoresErr = validateSetores(setores);
  if (setoresErr) return res.status(400).json({ error: setoresErr });

  if (!WORK_SCHEDULES_VALIDOS.includes(work_schedule)) {
    return res.status(400).json({ error: 'work_schedule deve ser seg_sex ou dom_sab' });
  }

  if (!COLOR_REGEX.test(color)) {
    return res.status(400).json({ error: 'color deve ser um hex válido (#RRGGBB)' });
  }

  const csm = Number(effectiveCycleStartMonth);
  if (!Number.isInteger(csm) || csm < 1 || csm > 12) {
    return res.status(400).json({ error: 'cycle_start_month deve ser entre 1 e 12' });
  }

  const csy = Number(effectiveCycleStartYear);
  if (!Number.isInteger(csy) || csy < MIN_CYCLE_START_YEAR) {
    return res.status(400).json({ error: `cycle_start_year deve ser um inteiro >= ${MIN_CYCLE_START_YEAR}` });
  }

  const employee = await transaction(async (client) => {
    const result = await client.query(
      'INSERT INTO employees (name, cargo, work_schedule, color, cycle_start_month, cycle_start_year) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name.trim(), 'Motorista', work_schedule, color, csm, csy]
    );

    const employeeId = result.rows[0].id;

    for (const setor of setores) {
      await client.query(
        'INSERT INTO employee_sectors (employee_id, setor) VALUES ($1, $2)',
        [employeeId, setor]
      );
    }

    await client.query(
      `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id, notes)
       VALUES ($1, $2, $3, $4)`,
      [employeeId, 24, restRules?.preferred_shift_id ?? null, restRules?.notes ?? null]
    );

    return (await client.query('SELECT * FROM employees WHERE id = $1', [employeeId])).rows[0];
  });

  const rules = (await query(
    'SELECT * FROM employee_rest_rules WHERE employee_id = $1',
    [employee.id]
  )).rows[0];
  const empSetores = await loadSetores(employee.id);
  res.status(201).json({ ...employee, setores: empSetores, vacations: [], restRules: rules });
});

// ── PUT /api/employees/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, setores, work_schedule, color, cycle_start_month, cycle_start_year, active, restRules } = req.body;
  const id = parseInt(req.params.id);

  const employee = (await query('SELECT id FROM employees WHERE id = $1', [id])).rows[0];
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

  if (cycle_start_month !== undefined && cycle_start_month !== null) {
    const csm = Number(cycle_start_month);
    if (!Number.isInteger(csm) || csm < 1 || csm > 12) {
      return res.status(400).json({ error: 'cycle_start_month deve ser entre 1 e 12' });
    }
  }

  if (cycle_start_year !== undefined && cycle_start_year !== null) {
    const csy = Number(cycle_start_year);
    if (!Number.isInteger(csy) || csy < MIN_CYCLE_START_YEAR) {
      return res.status(400).json({ error: `cycle_start_year deve ser um inteiro >= ${MIN_CYCLE_START_YEAR}` });
    }
  }

  await transaction(async (client) => {
    if (name !== undefined)
      await client.query('UPDATE employees SET name = $1, updated_at = NOW() WHERE id = $2', [name, id]);
    await client.query("UPDATE employees SET cargo = 'Motorista', updated_at = NOW() WHERE id = $1", [id]);
    if (work_schedule !== undefined)
      await client.query('UPDATE employees SET work_schedule = $1, updated_at = NOW() WHERE id = $2', [work_schedule, id]);
    if (color !== undefined)
      await client.query('UPDATE employees SET color = $1, updated_at = NOW() WHERE id = $2', [color, id]);
    if (cycle_start_month !== undefined && cycle_start_month !== null)
      await client.query('UPDATE employees SET cycle_start_month = $1, updated_at = NOW() WHERE id = $2', [Number(cycle_start_month), id]);
    if (cycle_start_year !== undefined && cycle_start_year !== null)
      await client.query('UPDATE employees SET cycle_start_year = $1, updated_at = NOW() WHERE id = $2', [Number(cycle_start_year), id]);
    if (active !== undefined)
      await client.query('UPDATE employees SET active = $1, updated_at = NOW() WHERE id = $2', [active, id]);

    if (setores !== undefined) {
      await client.query('DELETE FROM employee_sectors WHERE employee_id = $1', [id]);
      for (const setor of setores) {
        await client.query(
          'INSERT INTO employee_sectors (employee_id, setor) VALUES ($1, $2)',
          [id, setor]
        );
      }
    }

    if (restRules) {
      const existing = (await client.query(
        'SELECT id FROM employee_rest_rules WHERE employee_id = $1',
        [id]
      )).rows[0];
      if (existing) {
        if (restRules.preferred_shift_id !== undefined)
          await client.query(
            'UPDATE employee_rest_rules SET preferred_shift_id = $1 WHERE employee_id = $2',
            [restRules.preferred_shift_id, id]
          );
        if (restRules.notes !== undefined)
          await client.query(
            'UPDATE employee_rest_rules SET notes = $1 WHERE employee_id = $2',
            [restRules.notes, id]
          );
      } else {
        await client.query(
          `INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id, notes)
           VALUES ($1, $2, $3, $4)`,
          [id, 24, restRules.preferred_shift_id ?? null, restRules.notes ?? null]
        );
      }
    }
  });

  const updated = (await query('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  const rules = (await query(
    'SELECT * FROM employee_rest_rules WHERE employee_id = $1',
    [id]
  )).rows[0];
  const empSetores = await loadSetores(id);
  const empVacations = await loadVacations(id);
  res.json({ ...updated, setores: empSetores, vacations: empVacations, restRules: rules });
});

// ── DELETE /api/employees/:id (soft delete) ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const employee = (await query('SELECT id FROM employees WHERE id = $1', [id])).rows[0];
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  await query('UPDATE employees SET active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
  res.json({ success: true });
});

// ── GET /api/employees/:id/vacations ─────────────────────────────────────────
router.get('/:id/vacations', async (req, res) => {
  const id = parseInt(req.params.id);
  const employee = (await query('SELECT id FROM employees WHERE id = $1', [id])).rows[0];
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  res.json(await loadVacations(id));
});

// ── POST /api/employees/:id/vacations ────────────────────────────────────────
router.post('/:id/vacations', async (req, res) => {
  const id = parseInt(req.params.id);
  const { start_date, end_date, notes } = req.body;

  const employee = (await query('SELECT id FROM employees WHERE id = $1', [id])).rows[0];
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

  const overlap = (await query(
    'SELECT id FROM employee_vacations WHERE employee_id = $1 AND start_date <= $2 AND end_date >= $3',
    [id, end_date, start_date]
  )).rows[0];
  if (overlap) {
    return res.status(400).json({ error: `Período de férias conflita com férias existente (ID ${overlap.id})` });
  }

  const result = await query(
    'INSERT INTO employee_vacations (employee_id, start_date, end_date, notes) VALUES ($1, $2, $3, $4) RETURNING id',
    [id, start_date, end_date, notes ?? null]
  );

  const vacation = (await query(
    'SELECT * FROM employee_vacations WHERE id = $1',
    [result.rows[0].id]
  )).rows[0];
  res.status(201).json(vacation);
});

// ── PUT /api/employees/:id/vacations/:vid ─────────────────────────────────────
router.put('/:id/vacations/:vid', async (req, res) => {
  const id = parseInt(req.params.id);
  const vid = parseInt(req.params.vid);
  const { start_date, end_date, notes } = req.body;

  const vacation = (await query(
    'SELECT * FROM employee_vacations WHERE id = $1 AND employee_id = $2',
    [vid, id]
  )).rows[0];
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

  const overlap = (await query(
    'SELECT id FROM employee_vacations WHERE employee_id = $1 AND id != $2 AND start_date <= $3 AND end_date >= $4',
    [id, vid, newEnd, newStart]
  )).rows[0];
  if (overlap) {
    return res.status(400).json({ error: `Período de férias conflita com férias existente (ID ${overlap.id})` });
  }

  await query(
    'UPDATE employee_vacations SET start_date = $1, end_date = $2, notes = $3 WHERE id = $4',
    [newStart, newEnd, notes ?? vacation.notes, vid]
  );

  const updated = (await query('SELECT * FROM employee_vacations WHERE id = $1', [vid])).rows[0];
  res.json(updated);
});

// ── DELETE /api/employees/:id/vacations/:vid ──────────────────────────────────
router.delete('/:id/vacations/:vid', async (req, res) => {
  const id = parseInt(req.params.id);
  const vid = parseInt(req.params.vid);

  const vacation = (await query(
    'SELECT id FROM employee_vacations WHERE id = $1 AND employee_id = $2',
    [vid, id]
  )).rows[0];
  if (!vacation) return res.status(404).json({ error: 'Vacation not found' });

  await query('DELETE FROM employee_vacations WHERE id = $1', [vid]);
  res.json({ success: true });
});

export default router;
