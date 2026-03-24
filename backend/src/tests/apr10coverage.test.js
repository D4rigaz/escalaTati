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
  it('Fix #145: workers cs=1/2026 em semana Apr5-Apr11 (globalWi=13=42h) atingem 42h corretos', async () => {
    // Fix #145: antes, skippedAny degradava semana '42h' para 36h. Agora workers atingem 42h.
    // cycle_start=1/2026 → globalWi=13 → GLOBAL_PATTERN_12[1] = '42h'
    // Workers trabalham Dom,Ter,Qui,Sáb = 4 plantões = 42h (3×12h + 1×6h)
    const ids = [];
    ids.push(await createWorker('Amb 1', 1, 2026));
    ids.push(await createWorker('Amb 2', 1, 2026));
    ids.push(await createWorker('Amb 3', 1, 2026));
    ids.push(await createWorker('Amb 4', 1, 2026));

    await generateApril();

    const entries = await request(app)
      .get('/api/schedules?month=4&year=2026')
      .then((r) => r.body.entries);

    for (const empId of ids) {
      // Semana Apr5-Apr11: cada worker deve ter exatamente 42h (Fix #145)
      const w0 = entries.filter(
        (e) => e.employee_id === empId && e.date >= '2026-04-05' && e.date <= '2026-04-11'
      );
      const hours = w0.filter((e) => !e.is_day_off).reduce((s, e) => s + (e.duration_hours || 0), 0);
      expect(hours, `empId=${empId} semana Apr5-Apr11`).toBe(42);
    }
  });

  it('Fix #145: semana Apr12-Apr18 (globalWi=14=42h) também atinge 42h — segunda semana consecutiva', async () => {
    // Fix #145: semanas 42h consecutivas (Apr5-Apr11 e Apr12-Apr18) não se degradam mais.
    // PO rule: próximo domingo é sempre uma nova semana → Dom Apr12 não bloqueado pelo Sáb Apr11.
    const empId = await createWorker('Amb Fix145', 1, 2026);

    await generateApril();

    const entries = await request(app)
      .get('/api/schedules?month=4&year=2026')
      .then((r) => r.body.entries);

    const w1 = entries.filter(
      (e) => e.employee_id === empId && e.date >= '2026-04-12' && e.date <= '2026-04-18'
    );
    const hours = w1.filter((e) => !e.is_day_off).reduce((s, e) => s + (e.duration_hours || 0), 0);
    expect(hours, 'Abr semana 1 = 42h (Fix #145)').toBe(42);
  });

  it('sem_motorista NAO deve aparecer para Apr10 com workers em ciclos mistos', async () => {
    // cycle_start=2/2026 → globalWi=9 → GLOBAL_PATTERN_12[9] = '36h' (semana genuinamente 36h)
    // Workers em 36h têm 3 plantões via selectOffDays (dias variados por empId) — cobre Sex Apr10
    await createWorker('Amb 1', 2, 2026);
    await createWorker('Amb 2', 2, 2026);
    await createWorker('Amb 3', 2, 2026);
    await createWorker('Amb 4', 2, 2026);

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
