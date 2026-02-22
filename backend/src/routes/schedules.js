import { Router } from 'express';
import { getDb } from '../db/database.js';
import { generateSchedule } from '../services/scheduleGenerator.js';

const router = Router();

// GET /api/schedules?month=X&year=X
router.get('/', (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  const db = getDb();
  const m = parseInt(month);
  const y = parseInt(year);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const entries = db
    .prepare(
      `SELECT se.*, e.name as employee_name, e.cargo, e.setor,
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
router.post('/generate', (req, res) => {
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
    const result = generateSchedule({
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
  const id = parseInt(req.params.id);

  const entry = db.prepare('SELECT id FROM schedule_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  if (shift_type_id !== undefined)
    db.prepare('UPDATE schedule_entries SET shift_type_id = ? WHERE id = ?').run(shift_type_id, id);
  if (is_day_off !== undefined)
    db.prepare('UPDATE schedule_entries SET is_day_off = ? WHERE id = ?').run(is_day_off ? 1 : 0, id);
  if (is_locked !== undefined)
    db.prepare('UPDATE schedule_entries SET is_locked = ? WHERE id = ?').run(is_locked ? 1 : 0, id);
  if (notes !== undefined)
    db.prepare('UPDATE schedule_entries SET notes = ? WHERE id = ?').run(notes, id);

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
  const daysInMonth = new Date(y, m, 0).getDate();
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const result = db
    .prepare('DELETE FROM schedule_entries WHERE date >= ? AND date <= ?')
    .run(startDate, endDate);

  res.json({ success: true, deleted: result.changes });
});

export default router;
