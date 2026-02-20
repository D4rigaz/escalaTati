import { Router } from 'express';
import { exportExcel, exportPdf } from '../services/exportService.js';
import { format } from 'date-fns';

const router = Router();

// GET /api/export/excel?month=X&year=X
router.get('/excel', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  try {
    const buffer = await exportExcel(parseInt(month), parseInt(year));
    const filename = `escala_${year}_${String(month).padStart(2, '0')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/pdf?month=X&year=X
router.get('/pdf', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }

  try {
    const buffer = await exportPdf(parseInt(month), parseInt(year));
    const filename = `escala_${year}_${String(month).padStart(2, '0')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
