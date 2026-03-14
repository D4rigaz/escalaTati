/**
 * test: regressão issue #107 — Apr10 cobertura zero (withinWeeklyLimit overflow)
 *
 * Desenvolvedor Pleno
 *
 * Verifica que o Passo 4 do enforceDailyCoverage resolve o gap de cobertura
 * quando todos os workers atingem o limite CLT semanal antes de sexta.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

const APR2026 = { month: 4, year: 2026 };
const SHIFT_DIURNO_ID = 1;

async function createWorker(name, csm, csy) {
  const res = await request(app).post('/api/employees').send({
    name,
    setores: ['Transporte Ambulância'],
    cycle_start_month: csm,
    cycle_start_year: csy,
    work_schedule: 'dom_sab',
    restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
  });
  expect(res.status, `createWorker ${name}`).toBe(201);
  return res.body.id;
}

async function generateApril() {
  const res = await request(app)
    .post('/api/schedules/generate')
    .send({ ...APR2026, overwriteLocked: true });
  expect(res.status, 'generate').toBe(200);
  return res.body;
}

describe('Issue #107 — Passo 4: Apr10 cobertura com clt_weekly_overflow', () => {
  it('Apr10 (Sex) deve ter cobertura >= 1 apos Passo 4', async () => {
    await createWorker('Amb 1', 1, 2026);
    await createWorker('Amb 2', 2, 2026);
    await createWorker('Amb 3', 3, 2026);
    await createWorker('Amb 4', 1, 2026);

    await generateApril();

    const entries = await request(app)
      .get('/api/schedules?month=4&year=2026')
      .then((r) => r.body.entries);

    const apr10Workers = entries.filter((e) => e.date === '2026-04-10' && !e.is_day_off);
    expect(apr10Workers.length).toBeGreaterThanOrEqual(1);
  });

  it('deve emitir warning clt_weekly_overflow quando todos workers tem semana 36h (Passo 4 acionado)', async () => {
    // Todos com cycle_start=1/2026 => phase=1 => semana Apr5-Apr11 cltWi=0 => '36h' (limite 36h/3 turnos)
    // Apos 3 turnos (Dom+Qua+Sex ou Dom+Ter+Qui), limite atingido => Passo 4 dispara em algum dia da semana
    await createWorker('Amb 1', 1, 2026);
    await createWorker('Amb 2', 1, 2026);
    await createWorker('Amb 3', 1, 2026);
    await createWorker('Amb 4', 1, 2026);

    const gen = await generateApril();
    const warnings = gen.warnings || [];

    // Deve existir pelo menos 1 warning clt_weekly_overflow em alguma data de Abril
    const overflowWarnings = warnings.filter((w) => w.type === 'clt_weekly_overflow');
    expect(overflowWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('sem_motorista NAO deve aparecer para Apr10', async () => {
    await createWorker('Amb 1', 1, 2026);
    await createWorker('Amb 2', 2, 2026);
    await createWorker('Amb 3', 3, 2026);
    await createWorker('Amb 4', 1, 2026);

    const gen = await generateApril();
    const warnings = gen.warnings || [];

    const semMotoristaApr10 = warnings.filter(
      (w) => w.type === 'sem_motorista' && w.date === '2026-04-10'
    );
    expect(semMotoristaApr10.length).toBe(0);
  });

  it('total de horas por worker permanece <= 200h (Passo 4 nao causa sobrecarga extrema)', async () => {
    await createWorker('Amb 1', 1, 2026);
    await createWorker('Amb 2', 2, 2026);
    await createWorker('Amb 3', 3, 2026);
    await createWorker('Amb 4', 1, 2026);

    await generateApril();

    const totals = await request(app)
      .get('/api/schedules?month=4&year=2026')
      .then((r) => r.body.totals || []);

    for (const t of totals) {
      expect(t.total_hours, `worker ${t.employee_id} horas`).toBeLessThanOrEqual(200);
    }
  });
});
