import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/shift-types
router.get('/', (req, res) => {
  const db = getDb();
  const shiftTypes = db.prepare('SELECT * FROM shift_types ORDER BY id').all();
  res.json(shiftTypes);
});

// PUT /api/shift-types/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, start_time, end_time, duration_hours, color } = req.body;
  const id = req.params.id;

  const existing = db.prepare('SELECT id FROM shift_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Shift type not found' });

  db.prepare(
    `UPDATE shift_types SET
     name = COALESCE(?, name),
     start_time = COALESCE(?, start_time),
     end_time = COALESCE(?, end_time),
     duration_hours = COALESCE(?, duration_hours),
     color = COALESCE(?, color)
     WHERE id = ?`
  ).run(name ?? null, start_time ?? null, end_time ?? null, duration_hours ?? null, color ?? null, id);

  const updated = db.prepare('SELECT * FROM shift_types WHERE id = ?').get(id);
  res.json(updated);
});

export default router;
