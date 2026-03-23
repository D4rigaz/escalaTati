/**
 * test(generator): períodos de escala — semanas sempre completas (Dom→Sáb)
 *
 * Tester Senior
 *
 * Issue #112: a escala começa no primeiro domingo do mês e termina no sábado
 * anterior ao primeiro domingo do mês seguinte. Não há mais semana parcial
 * no início do período.
 *
 * Casos testados:
 *   Abril/2026: dia 01 = Quarta → primeiro domingo = 05/04
 *     Período: 05/04/2026 → 02/05/2026 (4 semanas × 7 dias = 28 dias)
 *     cltWeekOffset=0 — todas as semanas recebem meta CLT
 *
 *   Fevereiro/2025: dia 01 = Sábado → primeiro domingo = 02/02
 *     Período: 02/02/2025 → 01/03/2025 (4 semanas × 7 dias = 28 dias)
 *     cltWeekOffset=0 — todas as semanas recebem meta CLT
 *
 *   Março/2026: dia 01 = Domingo → primeiro domingo = 01/03
 *     Período: 01/03/2026 → 04/04/2026 (5 semanas × 7 dias = 35 dias)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';
import { getSchedulePeriod } from '../services/scheduleGenerator.js';

beforeEach(() => freshDb());

// ── Helper: getSchedulePeriod unit tests ──────────────────────────────────────

describe('getSchedulePeriod — cálculo de períodos', () => {
  it('Abril/2026: início 05/04, fim 02/05 (4 semanas)', () => {
    const { startDate, endDate } = getSchedulePeriod(4, 2026);
    expect(startDate).toBe('2026-04-05');
    expect(endDate).toBe('2026-05-02');
  });

  it('Março/2026: início 01/03 (já é domingo), fim 04/04 (5 semanas)', () => {
    const { startDate, endDate } = getSchedulePeriod(3, 2026);
    expect(startDate).toBe('2026-03-01');
    expect(endDate).toBe('2026-04-04');
  });

  it('Fevereiro/2025: início 02/02 (sábado → próximo domingo), fim 01/03', () => {
    const { startDate, endDate } = getSchedulePeriod(2, 2025);
    expect(startDate).toBe('2025-02-02');
    expect(endDate).toBe('2025-03-01');
  });

  it('período sempre começa no domingo (dow=0)', () => {
    for (const [m, y] of [[1,2026],[2,2026],[3,2026],[4,2026],[5,2026],[12,2025]]) {
      const { startDate } = getSchedulePeriod(m, y);
      const dow = new Date(startDate + 'T12:00:00').getDay();
      expect(dow, `${m}/${y} startDate=${startDate}`).toBe(0);
    }
  });

  it('período sempre termina no sábado (dow=6)', () => {
    for (const [m, y] of [[1,2026],[2,2026],[3,2026],[4,2026],[5,2026],[12,2025]]) {
      const { endDate } = getSchedulePeriod(m, y);
      const dow = new Date(endDate + 'T12:00:00').getDay();
      expect(dow, `${m}/${y} endDate=${endDate}`).toBe(6);
    }
  });

  it('número de dias sempre múltiplo de 7 (semanas completas)', () => {
    for (const [m, y] of [[1,2026],[2,2026],[3,2026],[4,2026],[5,2026],[12,2025]]) {
      const { startDate, endDate } = getSchedulePeriod(m, y);
      const days = (new Date(endDate + 'T12:00:00') - new Date(startDate + 'T12:00:00')) / 86_400_000 + 1;
      expect(days % 7, `${m}/${y}: ${days} dias`).toBe(0);
    }
  });
});

// ── Integration: geração usa o período correto ────────────────────────────────

async function createNoturnoEmployee(name, cycleStartMonth, cycleStartYear) {
  const shiftsRes = await request(app).get('/api/shift-types');
  const noturnoId = shiftsRes.body.find((s) => s.name === 'Noturno')?.id;
  expect(noturnoId).toBeDefined();
  const empRes = await request(app).post('/api/employees').send({
    name,
    setores: ['Transporte Ambulância'],
    cycle_start_month: cycleStartMonth,
    cycle_start_year: cycleStartYear,
    restRules: { preferred_shift_id: noturnoId, notes: null },
  });
  expect(empRes.status).toBe(201);
  return empRes.body;
}

describe('Abril/2026 — período 05/04 a 02/05 sem semana parcial', () => {
  it('entries cobrem exatamente 05/04/2026 a 02/05/2026 (28 dias)', async () => {
    const emp = await createNoturnoEmployee('Noturno Abr', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send({ month: 4, year: 2026 });
    expect(genRes.status).toBe(200);
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    expect(schedRes.status).toBe(200);
    const entries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    expect(entries.length).toBe(28);
    const dates = entries.map((e) => e.date).sort();
    expect(dates[0]).toBe('2026-04-05');
    expect(dates[dates.length - 1]).toBe('2026-05-02');
  });

  it('todas as semanas do período têm 7 dias (sem semana parcial)', async () => {
    const emp = await createNoturnoEmployee('Noturno Abr Full', 2, 2025);
    await request(app).post('/api/schedules/generate').send({ month: 4, year: 2026 });
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    const entries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    // Agrupa por semana (Dom→Sáb)
    const weekMap = {};
    for (const e of entries) {
      const d = new Date(e.date + 'T12:00:00');
      const dow = d.getDay();
      const sun = new Date(d);
      sun.setDate(d.getDate() - dow);
      const key = sun.toISOString().slice(0, 10);
      weekMap[key] = (weekMap[key] || 0) + 1;
    }
    for (const [week, count] of Object.entries(weekMap)) {
      expect(count, `semana ${week}`).toBe(7);
    }
  });

  // Fase CLT — cycle_start=Fev/2025 em Abr/2026 (fix #127 — índice global):
  //   cycleFirstSunday=2025-02-02
  //   Abr 05-11 (2026-04-05): globalWeekIdx=61, 61%12=1 → GLOBAL_PATTERN_12[1]='42h'
  //   Abr 12-18 (2026-04-12): globalWeekIdx=62, 62%12=2 → GLOBAL_PATTERN_12[2]='42h'
  it('semana (05-11/Abr) recebe 42h NOTURNO (3×12h + 1×6h)', async () => {
    const emp = await createNoturnoEmployee('Noturno Abr CLT', 2, 2025);
    await request(app).post('/api/schedules/generate').send({ month: 4, year: 2026 });
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    const entries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    const week1Dates = ['2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-11'];
    const week1Hours = entries
      .filter((e) => week1Dates.includes(e.date) && !e.is_day_off)
      .reduce((s, e) => s + (e.duration_hours || 0), 0);
    expect(week1Hours).toBe(42);
  });

  it('semana (12-18/Abr) recebe 42h com índice global (fix #127)', async () => {
    // Fix #127: cycle_start=Fev/2025 — cycleFirstSunday=2025-02-02.
    // Abr 12-18 (2026-04-12): globalWeekIdx=62, 62%12=2 → GLOBAL_PATTERN_12[2]='42h'.
    // 42h NOTURNO = 3×12h + 1×6h → a semana CONTÉM o turno de 6h.
    const emp = await createNoturnoEmployee('Noturno Abr CLT42', 2, 2025);
    await request(app).post('/api/schedules/generate').send({ month: 4, year: 2026 });
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    const entries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    const week2Dates = ['2026-04-12','2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17','2026-04-18'];
    const week2Entries = entries.filter((e) => week2Dates.includes(e.date) && !e.is_day_off);
    const week2Hours = week2Entries.reduce((s, e) => s + (e.duration_hours || 0), 0);
    expect(week2Hours).toBe(42);
    expect(week2Entries.some((e) => e.duration_hours === 6)).toBe(true);
  });
});

describe('Fevereiro/2025 — período 02/02 a 01/03', () => {
  it('geração não trava nem gera erro — status 200', async () => {
    await createNoturnoEmployee('Noturno Fev', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send({ month: 2, year: 2025 });
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);
  });

  it('entries cobrem exatamente 02/02/2025 a 01/03/2025 (28 dias)', async () => {
    const emp = await createNoturnoEmployee('Noturno Fev Full', 2, 2025);
    await request(app).post('/api/schedules/generate').send({ month: 2, year: 2025 });
    const schedRes = await request(app).get('/api/schedules?month=2&year=2025');
    const entries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    expect(entries.length).toBe(28);
    const dates = entries.map((e) => e.date).sort();
    expect(dates[0]).toBe('2025-02-02');
    expect(dates[dates.length - 1]).toBe('2025-03-01');
  });
});
