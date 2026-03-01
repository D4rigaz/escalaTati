import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/shift-types
router.get('/', (req, res) => {
  const db = getDb();
  const shiftTypes = db.prepare('SELECT * FROM shift_types ORDER BY id').all();
  res.json(shiftTypes);
});

// POST /api/shift-types — desabilitado: turnos são fixos e imutáveis
router.post('/', (_req, res) => {
  res.status(403).json({ error: 'Turnos são fixos e não podem ser criados' });
});

// PUT /api/shift-types/:id — desabilitado: turnos são fixos e imutáveis
router.put('/:id', (_req, res) => {
  res.status(403).json({ error: 'Turnos são fixos e não podem ser editados' });
});

// DELETE /api/shift-types/:id — desabilitado: turnos são fixos e imutáveis
router.delete('/:id', (_req, res) => {
  res.status(403).json({ error: 'Turnos são fixos e não podem ser excluídos' });
});

export default router;
