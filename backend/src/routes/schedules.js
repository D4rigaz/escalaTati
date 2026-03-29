import { Router } from 'express';
import { query } from '../db/database.js';
import { generateSchedule, getSchedulePeriod } from '../services/scheduleGenerator.js';

const router = Router();

// GET /api/schedules/generations[?month=&year=]
router.get('/generations', async (req, res) => {
  const { month, year } = req.query;

  let sql = 'SELECT id, month, year, generated_at, params_json FROM schedule_generations';
  let paramIdx = 1;
  const params = [];

  if (month && year) {
    sql += ` WHERE month = $${paramIdx++} AND year = $${paramIdx++}`;
    params.push(Number(month), Number(year));
  } else if (month) {
    sql += ` WHERE month = $${paramIdx++}`;
    params.push(Number(month));
  } else if (year) {
    sql += ` WHERE year = $${paramIdx++}`;
    params.push(Number(year));
  }

  sql += ' ORDER BY id DESC';

  const rows = (await query(sql, params)).rows;
  const generations = rows.map(r => ({
    ...r,
    params_json: JSON.parse(r.params_json),
  }));

  res.json(generations);
});

// GET /api/schedules?month=X&year=X
router.get('/', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const m = parseInt(month);
  const y = parseInt(year);
  const { startDate, endDate } = getSchedulePeriod(m, y);

  const entries = (await query(
    `SELECT se.*,
            e.name as employee_name, e.cargo, e.color as employee_color,
            e.work_schedule as employee_work_schedule,
            st.name as shift_name, st.color as shift_color, st.start_time, st.end_time, st.duration_hours
     FROM schedule_entries se
     JOIN employees e ON se.employee_id = e.id AND e.active = TRUE
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.date >= $1 AND se.date <= $2
     ORDER BY se.date, e.name`,
    [startDate, endDate]
  )).rows;

  // Compute totals per employee
  const employeeTotals = {};
  for (const entry of entries) {
    if (!employeeTotals[entry.employee_id]) {
      employeeTotals[entry.employee_id] = {
        employee_id: entry.employee_id,
        employee_name: entry.employee_name,
        total_hours: 0,
      };
    }
    if (!entry.is_day_off && entry.duration_hours) {
      employeeTotals[entry.employee_id].total_hours += entry.duration_hours;
    }
  }

  res.json({
    month: m,
    year: y,
    entries,
    totals: Object.values(employeeTotals),
  });
});

// POST /api/schedules/generate
router.post('/generate', async (req, res) => {
  const { month, year, overwriteLocked = false } = req.body;

  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const m = parseInt(month);
  const y = parseInt(year);

  if (isNaN(m) || m < 1 || m > 12) {
    return res.status(400).json({ error: 'month must be between 1 and 12' });
  }
  if (isNaN(y) || y < 2000 || y > 2100) {
    return res.status(400).json({ error: 'year must be between 2000 and 2100' });
  }

  try {
    const result = await generateSchedule({
      month: m,
      year: y,
      overwriteLocked,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/schedules/entry/:id
router.put('/entry/:id', async (req, res) => {
  const { shift_type_id, is_day_off, is_locked, notes } = req.body;
  // Normalizar string vazia para null — "" não é um setor válido e não deve ser gravado no DB.
  const setor_override = req.body.setor_override === '' ? null : req.body.setor_override;
  const id = parseInt(req.params.id);

  const entry = (await query(
    'SELECT se.*, e.id as emp_id FROM schedule_entries se JOIN employees e ON se.employee_id = e.id WHERE se.id = $1',
    [id]
  )).rows[0];
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  // Validate setor_override belongs to the employee's setores
  if (setor_override !== undefined && setor_override !== null) {
    const empSetores = (await query(
      'SELECT setor FROM employee_sectors WHERE employee_id = $1',
      [entry.employee_id]
    )).rows.map((r) => r.setor);
    if (!empSetores.includes(setor_override)) {
      return res.status(400).json({ error: 'setor_override deve ser um setor do funcionário' });
    }
  }

  if (shift_type_id !== undefined)
    await query('UPDATE schedule_entries SET shift_type_id = $1 WHERE id = $2', [shift_type_id, id]);
  if (is_day_off !== undefined)
    await query('UPDATE schedule_entries SET is_day_off = $1 WHERE id = $2', [is_day_off, id]);
  if (is_locked !== undefined)
    await query('UPDATE schedule_entries SET is_locked = $1 WHERE id = $2', [is_locked, id]);
  if (notes !== undefined)
    await query('UPDATE schedule_entries SET notes = $1 WHERE id = $2', [notes, id]);
  if (setor_override !== undefined)
    await query('UPDATE schedule_entries SET setor_override = $1 WHERE id = $2', [setor_override, id]);

  const updated = (await query(
    `SELECT se.*, st.name as shift_name, st.color as shift_color, st.duration_hours
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.id = $1`,
    [id]
  )).rows[0];

  res.json(updated);
});

// DELETE /api/schedules/month?month=X&year=X
router.delete('/month', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const m = parseInt(month);
  const y = parseInt(year);
  const { startDate, endDate } = getSchedulePeriod(m, y);

  const result = await query(
    'DELETE FROM schedule_entries WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  );

  res.json({ success: true, deleted: result.rowCount });
});

export default router;
