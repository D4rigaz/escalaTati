import { Router } from 'express';
import { getDb } from '../db/database.js';
import { generateSchedule, getSchedulePeriod } from '../services/scheduleGenerator.js';

const router = Router();

// GET /api/schedules/generations[?month=&year=]
router.get('/generations', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  let sql = 'SELECT id, month, year, generated_at, params_json FROM schedule_generations';
  const params = [];

  if (month && year) {
    sql += ' WHERE month = ? AND year = ?';
    params.push(Number(month), Number(year));
  } else if (month) {
    sql += ' WHERE month = ?';
    params.push(Number(month));
  } else if (year) {
    sql += ' WHERE year = ?';
    params.push(Number(year));
  }

  sql += ' ORDER BY id DESC';

  const rows = db.prepare(sql).all(...params);
  const generations = rows.map(r => ({
    ...r,
    params_json: JSON.parse(r.params_json),
  }));

  res.json(generations);
});

// GET /api/schedules?month=X&year=X
router.get('/', (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const db = getDb();
  const m = parseInt(month);
  const y = parseInt(year);
  const { startDate, endDate } = getSchedulePeriod(m, y);

  const entries = db
    .prepare(
      `SELECT se.*,
              e.name as employee_name, e.cargo, e.color as employee_color,
              e.work_schedule as employee_work_schedule,
              st.name as shift_name, st.color as shift_color, st.start_time, st.end_time, st.duration_hours
       FROM schedule_entries se
       JOIN employees e ON se.employee_id = e.id
       LEFT JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date >= ? AND se.date <= ?
       ORDER BY se.date, e.name`
    )
    .all(startDate, endDate);

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
router.put('/entry/:id', (req, res) => {
  const db = getDb();
  const { shift_type_id, is_day_off, is_locked, notes } = req.body;
  // Normalizar string vazia para null — "" não é um setor válido e não deve ser gravado no DB.
  const setor_override = req.body.setor_override === '' ? null : req.body.setor_override;
  const id = parseInt(req.params.id);

  const entry = db
    .prepare('SELECT se.*, e.id as emp_id FROM schedule_entries se JOIN employees e ON se.employee_id = e.id WHERE se.id = ?')
    .get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  // Validate setor_override belongs to the employee's setores
  if (setor_override !== undefined && setor_override !== null) {
    const empSetores = db
      .prepare('SELECT setor FROM employee_sectors WHERE employee_id = ?')
      .all(entry.employee_id)
      .map((r) => r.setor);
    if (!empSetores.includes(setor_override)) {
      return res.status(400).json({ error: 'setor_override deve ser um setor do funcionário' });
    }
  }

  if (shift_type_id !== undefined)
    db.prepare('UPDATE schedule_entries SET shift_type_id = ? WHERE id = ?').run(shift_type_id, id);
  if (is_day_off !== undefined)
    db.prepare('UPDATE schedule_entries SET is_day_off = ? WHERE id = ?').run(is_day_off ? 1 : 0, id);
  if (is_locked !== undefined)
    db.prepare('UPDATE schedule_entries SET is_locked = ? WHERE id = ?').run(is_locked ? 1 : 0, id);
  if (notes !== undefined)
    db.prepare('UPDATE schedule_entries SET notes = ? WHERE id = ?').run(notes, id);
  if (setor_override !== undefined)
    db.prepare('UPDATE schedule_entries SET setor_override = ? WHERE id = ?').run(setor_override, id);

  const updated = db
    .prepare(
      `SELECT se.*, st.name as shift_name, st.color as shift_color, st.duration_hours
       FROM schedule_entries se
       LEFT JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.id = ?`
    )
    .get(id);

  res.json(updated);
});

// DELETE /api/schedules/month?month=X&year=X
router.delete('/month', (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const db = getDb();
  const m = parseInt(month);
  const y = parseInt(year);
  const { startDate, endDate } = getSchedulePeriod(m, y);

  const result = db
    .prepare('DELETE FROM schedule_entries WHERE date >= ? AND date <= ?')
    .run(startDate, endDate);

  res.json({ success: true, deleted: result.changes });
});

export default router;
