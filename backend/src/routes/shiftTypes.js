import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/shift-types
router.get('/', (req, res) => {
  const db = getDb();
  const shiftTypes = db.prepare('SELECT * FROM shift_types ORDER BY id').all();
  res.json(shiftTypes);
});

// POST /api/shift-types
router.post('/', (req, res) => {
  const db = getDb();
  const { name, start_time, end_time, duration_hours, color } = req.body;

  if (!name || !start_time || !end_time || !duration_hours || !color) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, start_time, end_time, duration_hours, color' });
  }

  const duplicate = db.prepare('SELECT id FROM shift_types WHERE name = ?').get(name);
  if (duplicate) return res.status(409).json({ error: 'Já existe um turno com esse nome' });

  const result = db.prepare(
    'INSERT INTO shift_types (name, start_time, end_time, duration_hours, color) VALUES (?, ?, ?, ?, ?)'
  ).run(name, start_time, end_time, duration_hours, color);

  const created = db.prepare('SELECT * FROM shift_types WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PUT /api/shift-types/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, start_time, end_time, duration_hours, color } = req.body;
  const id = req.params.id;

  const existing = db.prepare('SELECT id FROM shift_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Turno não encontrado' });

  if (name) {
    const duplicate = db.prepare('SELECT id FROM shift_types WHERE name = ? AND id != ?').get(name, id);
    if (duplicate) return res.status(409).json({ error: 'Já existe um turno com esse nome' });
  }

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

// DELETE /api/shift-types/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = req.params.id;

  const existing = db.prepare('SELECT id FROM shift_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Turno não encontrado' });

  const inUse = db.prepare('SELECT COUNT(*) as c FROM schedule_entries WHERE shift_type_id = ?').get(id);
  if (inUse.c > 0) {
    return res.status(409).json({ error: 'Este turno está sendo usado em escalas geradas e não pode ser excluído' });
  }

  db.prepare('UPDATE employee_rest_rules SET preferred_shift_id = NULL WHERE preferred_shift_id = ?').run(id);
  db.prepare('DELETE FROM shift_types WHERE id = ?').run(id);

  res.json({ success: true });
});

export default router;
