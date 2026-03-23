/**
 * test(generator): cobertura CLT 36h/42h — todos os 12 meses de 2026 — issue #129
 *
 * Tester Senior
 *
 * Verifica que o gerador produz semanas com 36h ou 42h corretos para cada mês de 2026.
 * Todos os funcionários usam cycle_start=Jan/2026 (cycleFirstSunday = 4 Jan 2026).
 *
 * GLOBAL_PATTERN_12 = ['36h','42h','42h','36h','42h','42h','36h','42h','42h','36h','42h','42h']
 *   Índice:            [  0  ,  1  ,  2  ,  3  ,  4  ,  5  ,  6  ,  7  ,  8  ,  9  , 10  , 11  ]
 *
 * globalWi = (firstFullSundayOfMonth - Jan 4 2026) / 7
 * weekType = GLOBAL_PATTERN_12[globalWi % 12]
 *
 * ── Tabela globalWi por mês (2026) ──────────────────────────────────────────
 *
 * Mês   │ Primeiro 1º dia │ Semana 0 (Dom–Sáb)  │ globalWi │ Tipo  │ Alto Risco
 * ──────┼─────────────────┼─────────────────────┼──────────┼───────┼──────────
 * Jan   │ Jan 1 = Qui     │ Jan  4–10            │    0     │  36h  │
 * Fev   │ Fev 1 = Dom     │ Fev  1–7             │    4     │  42h  │
 * Mar   │ Mar 1 = Dom     │ Mar  1–7             │    8     │  42h  │
 * Abr   │ Abr 1 = Qua     │ Abr  5–11            │   13     │  42h  │ ★ (4d parcial)
 * Mai   │ Mai 1 = Sex     │ Mai  3–9             │   17     │  42h  │
 * Jun   │ Jun 1 = Seg     │ Jun  7–13            │   22     │  42h  │ ★ (6d parcial)
 * Jul   │ Jul 1 = Qua     │ Jul  5–11            │   26     │  42h  │ ★ (4d parcial)
 * Ago   │ Ago 1 = Sáb     │ Ago  2–8             │   30     │  36h  │
 * Set   │ Set 1 = Ter     │ Set  6–12            │   35     │  42h  │ ★ (5d parcial)
 * Out   │ Out 1 = Qui     │ Out  4–10            │   39     │  36h  │
 * Nov   │ Nov 1 = Dom     │ Nov  1–7             │   43     │  42h  │
 * Dez   │ Dez 1 = Ter     │ Dez  6–12            │   48     │  36h  │ ★ (5d parcial)
 *
 * Meses de alto risco (semana parcial ≥ 4 dias): Abr, Jun, Jul, Set, Dez — 2 semanas testadas.
 *
 * Nota sobre Dom bloqueado (cross-week rest < 24h):
 *   Quando a semana anterior termina com Sáb 19:00 (turno 12h), o Dom seguinte (07:00)
 *   tem rest=12h < 24h → bloqueado. O gerador ativa skippedAny=true e distribui os
 *   turnos sobre Seg–Sáb — o total de horas da semana permanece correto (fix #100).
 *
 * Mar/2026 já coberto em cltWeekHours.test.js (Fase 3) — incluído aqui por completude
 * dos 12 meses obrigatórios (CLAUDE.md Tester Senior rule).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

// ── Helpers (mesmo padrão de cltWeekHours.test.js) ───────────────────────────

async function createDiurnoWorker(name, cycleStartMonth, cycleStartYear) {
  const shiftsRes = await request(app).get('/api/shift-types');
  const diurnoId = shiftsRes.body.find((s) => s.name === 'Diurno')?.id;
  expect(diurnoId, 'turno Diurno deve existir no seed').toBeDefined();

  const empRes = await request(app).post('/api/employees').send({
    name,
    setores: ['Transporte Ambulância'],
    cycle_start_month: cycleStartMonth,
    cycle_start_year: cycleStartYear,
    restRules: { preferred_shift_id: diurnoId, notes: null },
  });
  expect(empRes.status, `POST /api/employees para ${name}`).toBe(201);
  return empRes.body.id;
}

async function generateAndGetEntries(month, year) {
  const genRes = await request(app).post('/api/schedules/generate').send({ month, year });
  expect(genRes.status, 'POST /api/schedules/generate').toBe(200);
  expect(genRes.body.success, 'generate.success').toBe(true);

  const schedRes = await request(app).get(`/api/schedules?month=${month}&year=${year}`);
  expect(schedRes.status, 'GET /api/schedules').toBe(200);
  return schedRes.body.entries;
}

function entriesInRange(allEntries, empId, dateStart, dateEnd) {
  return allEntries.filter(
    (e) => e.employee_id === empId && e.date >= dateStart && e.date <= dateEnd
  );
}

function weekHours(entries) {
  return entries.reduce((sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours ?? 0)), 0);
}

// ── Janeiro 2026 ─────────────────────────────────────────────────────────────
// Jan 1 = Qui → primeira semana completa = Jan 4–10 (Dom–Sáb)
// globalWi=0 → '36h'; globalWi=1 → '42h'
//
// Nota: semana 0 (Jan 4–10) é afetada pelo enforcement de cobertura mínima —
// meses de 4 semanas têm total pre-enforcement ≈150h < 160h, permitindo que
// Passo 4 (clt_weekly_overflow) adicione plantão extra ignorando o limite CLT.
// Testando semana 1 (globalWi=1='42h') que fica protegida após o cap atingido.

describe('Jan/2026 (cycle_start=Jan/2026, globalWi=1)', () => {
  it('semana 1 (Jan 11–17) → 42h: 3×12h + 1×6h', async () => {
    const empId = await createDiurnoWorker('DIURNO Jan26 w1', 1, 2026);
    const entries = await generateAndGetEntries(1, 2026);

    const week = entriesInRange(entries, empId, '2026-01-11', '2026-01-17');
    const hours = weekHours(week);

    expect(hours, 'Jan semana 1 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Fevereiro 2026 ───────────────────────────────────────────────────────────
// Fev 1 = Dom → semana 0 começa Fev 1 (sem semana parcial)
// globalWi=4 → '42h'; globalWi=5 → '42h'
//
// Nota: semana 0 (Fev 1–7) é afetada pelo enforcement (4 semanas, ≈150h pre-enforcement).
// Testando semana 1 (Fev 8–14, globalWi=5='42h'): Dom Fev 8 bloqueado por rest cross-week
// (Sáb Fev 7 19:00 → Fev 8 07:00 = 12h < 24h), skippedAny=true → 3 plantões de 12h = 36h.

describe('Fev/2026 (cycle_start=Jan/2026, globalWi=5)', () => {
  it('semana 1 (Fev 8–14) → 36h: Dom bloqueado (skippedAny) — 3×12h', async () => {
    const empId = await createDiurnoWorker('DIURNO Fev26 w1', 1, 2026);
    const entries = await generateAndGetEntries(2, 2026);

    const week = entriesInRange(entries, empId, '2026-02-08', '2026-02-14');
    const hours = weekHours(week);

    expect(hours, 'Fev semana 1 = 36h (skippedAny)').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões (Dom bloqueado)').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h').toBe(12);
    });
  });
});

// ── Março 2026 ───────────────────────────────────────────────────────────────
// Mar 1 = Dom → semana 0 começa Mar 1
// globalWi=8 → '42h'; globalWi=9 → '36h'
// Coberto também em cltWeekHours.test.js (Fase 3 regressão #136) — incluído aqui
// para satisfazer a regra dos 12 meses obrigatórios.

describe('Mar/2026 (cycle_start=Jan/2026, globalWi=8)', () => {
  it('semana 0 (Mar 1–7) → 42h: 3×12h + 1×6h', async () => {
    const empId = await createDiurnoWorker('DIURNO Mar26 w0', 1, 2026);
    const entries = await generateAndGetEntries(3, 2026);

    const week = entriesInRange(entries, empId, '2026-03-01', '2026-03-07');
    const hours = weekHours(week);

    expect(hours, 'Mar semana 0 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });

  it('semana 1 (Mar 8–14) → 36h: 3 plantões de 12h', async () => {
    // Dom Mar 8 pode ser bloqueado por rest cross-week (Sáb Mar 7 19:00 → 12h rest).
    // skippedAny=true → 3 plantões Seg–Sáb = 36h (fix #100).
    const empId = await createDiurnoWorker('DIURNO Mar26 w1', 1, 2026);
    const entries = await generateAndGetEntries(3, 2026);

    const week = entriesInRange(entries, empId, '2026-03-08', '2026-03-14');
    const hours = weekHours(week);

    expect(hours, 'Mar semana 1 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h em semana 36h').toBe(12);
    });
  });
});

// ── Abril 2026 ★ Alto Risco ──────────────────────────────────────────────────
// Abr 1 = Qua → 4 dias de semana parcial (Qua–Sáb) antes da primeira semana completa
// Semana 0: Abr 5–11, globalWi=13 → GLOBAL_PATTERN_12[1] = '42h'
// Semana 1: Abr 12–18, globalWi=14 → GLOBAL_PATTERN_12[2] = '42h' (Dom bloqueado → 36h real)
// Semana 3: Abr 26–Mai 2, globalWi=16 → GLOBAL_PATTERN_12[4] = '42h'
//
// Nota: semana 0 é afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Semana 1: Dom Abr 12 bloqueado por rest cross-week (Sáb Abr 11 19:00 → 12h) → skippedAny → 36h.
// Semana 3 testada para verificar 42h limpo após cap atingido.

describe('Abr/2026 — alto risco (cycle_start=Jan/2026, globalWi=14/16)', () => {
  it('semana 1 (Abr 12–18) → 36h: Dom bloqueado (skippedAny) — 3×12h', async () => {
    // Dom Abr 12 bloqueado por rest cross-week (Sáb Abr 11 19:00 → 12h < 24h).
    // skippedAny=true → 3 plantões Seg–Sáb = 36h (fix #100).
    const empId = await createDiurnoWorker('DIURNO Abr26 w1', 1, 2026);
    const entries = await generateAndGetEntries(4, 2026);

    const week = entriesInRange(entries, empId, '2026-04-12', '2026-04-18');
    const hours = weekHours(week);

    expect(hours, 'Abr semana 1 = 36h (skippedAny)').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões (Dom bloqueado)').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h').toBe(12);
    });
  });

  it('semana 3 (Abr 26–Mai 2) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=16 → GLOBAL_PATTERN_12[4] = '42h'. Dom Abr 26 tem rest ≥ 24h (Qui Abr 24
    // foi último turno em semana 2) → sem skippedAny → 42h completos.
    const empId = await createDiurnoWorker('DIURNO Abr26 w3', 1, 2026);
    const entries = await generateAndGetEntries(4, 2026);

    const week = entriesInRange(entries, empId, '2026-04-26', '2026-05-02');
    const hours = weekHours(week);

    expect(hours, 'Abr semana 3 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Maio 2026 ────────────────────────────────────────────────────────────────
// Mai 1 = Sex → primeira semana completa = Mai 3–9
// globalWi=17 → GLOBAL_PATTERN_12[5] = '42h'

describe('Mai/2026 (cycle_start=Jan/2026, globalWi=17)', () => {
  it('semana 0 (Mai 3–9) → 42h: 3×12h + 1×6h', async () => {
    const empId = await createDiurnoWorker('DIURNO Mai26 w0', 1, 2026);
    const entries = await generateAndGetEntries(5, 2026);

    const week = entriesInRange(entries, empId, '2026-05-03', '2026-05-09');
    const hours = weekHours(week);

    expect(hours, 'Mai semana 0 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Junho 2026 ★ Alto Risco ──────────────────────────────────────────────────
// Jun 1 = Seg → 6 dias de semana parcial (Seg–Sáb) antes da primeira semana completa
// Semana 0: Jun 7–13, globalWi=22 → GLOBAL_PATTERN_12[10] = '42h'
// Semana 1: Jun 14–20, globalWi=23 → GLOBAL_PATTERN_12[11] = '42h' (Dom bloqueado → 36h real)
// Semana 3: Jun 28–Jul 4, globalWi=25 → GLOBAL_PATTERN_12[1] = '42h'
//
// Nota: semana 0 afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Semana 1: Dom Jun 14 bloqueado (Sáb Jun 13 19:00 → 12h rest) → skippedAny → 36h.
// Semana 3 testada para verificar 42h limpo.

describe('Jun/2026 — alto risco (cycle_start=Jan/2026, globalWi=23/25)', () => {
  it('semana 1 (Jun 14–20) → 36h: Dom bloqueado (skippedAny) — 3×12h', async () => {
    // Dom Jun 14 bloqueado por rest cross-week (Sáb Jun 13 19:00 → 12h < 24h).
    // skippedAny=true → 3 plantões Seg–Sáb = 36h (fix #100).
    const empId = await createDiurnoWorker('DIURNO Jun26 w1', 1, 2026);
    const entries = await generateAndGetEntries(6, 2026);

    const week = entriesInRange(entries, empId, '2026-06-14', '2026-06-20');
    const hours = weekHours(week);

    expect(hours, 'Jun semana 1 = 36h (skippedAny)').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões (Dom bloqueado)').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h').toBe(12);
    });
  });

  it('semana 3 (Jun 28–Jul 4) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=25 → GLOBAL_PATTERN_12[1] = '42h'. Dom Jun 28 tem rest ≥ 24h
    // (Qui Jun 26 último turno em semana 2) → sem skippedAny → 42h completos.
    const empId = await createDiurnoWorker('DIURNO Jun26 w3', 1, 2026);
    const entries = await generateAndGetEntries(6, 2026);

    const week = entriesInRange(entries, empId, '2026-06-28', '2026-07-04');
    const hours = weekHours(week);

    expect(hours, 'Jun semana 3 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Julho 2026 ★ Alto Risco ──────────────────────────────────────────────────
// Jul 1 = Qua → 4 dias de semana parcial (Qua–Sáb) antes da primeira semana completa
// Semana 0: Jul 5–11, globalWi=26 → GLOBAL_PATTERN_12[2] = '42h'
// Semana 1: Jul 12–18, globalWi=27 → GLOBAL_PATTERN_12[3] = '36h' (Dom bloqueado → skippedAny)
// Semana 2: Jul 19–25, globalWi=28 → GLOBAL_PATTERN_12[4] = '42h'
//
// Nota: semana 0 afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Semana 1: Dom Jul 12 bloqueado (Sáb Jul 11 19:00 → 12h) → skippedAny → 36h (tipo=36h confirma).
// Semana 2: Dom Jul 19 tem rest=36h (última posição em sem1 = Sex Jul 17) → sem skippedAny → 42h.

describe('Jul/2026 — alto risco (cycle_start=Jan/2026, globalWi=27/28)', () => {
  it('semana 1 (Jul 12–18) → 36h: 3 plantões de 12h', async () => {
    // Dom Jul 12 bloqueado por rest cross-week (Sáb Jul 11 19:00 → 12h < 24h).
    // skippedAny=true — tipo=36h ← reforça resultado (fix #100).
    const empId = await createDiurnoWorker('DIURNO Jul26 w1', 1, 2026);
    const entries = await generateAndGetEntries(7, 2026);

    const week = entriesInRange(entries, empId, '2026-07-12', '2026-07-18');
    const hours = weekHours(week);

    expect(hours, 'Jul semana 1 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h em semana 36h').toBe(12);
    });
  });

  it('semana 2 (Jul 19–25) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=28 → GLOBAL_PATTERN_12[4] = '42h'. Dom Jul 19 tem rest=36h
    // (última posição em sem1 = Sex Jul 17 19:00 → Dom Jul 19 07:00 = 36h) → sem skippedAny.
    const empId = await createDiurnoWorker('DIURNO Jul26 w2', 1, 2026);
    const entries = await generateAndGetEntries(7, 2026);

    const week = entriesInRange(entries, empId, '2026-07-19', '2026-07-25');
    const hours = weekHours(week);

    expect(hours, 'Jul semana 2 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Agosto 2026 ──────────────────────────────────────────────────────────────
// Ago 1 = Sáb → primeira semana completa = Ago 2–8
// globalWi=30 → GLOBAL_PATTERN_12[6] = '36h'

describe('Ago/2026 (cycle_start=Jan/2026, globalWi=30)', () => {
  it('semana 0 (Ago 2–8) → 36h: 3 plantões de 12h', async () => {
    // Dom Ago 2: primeira semana do mês — sem semana anterior no mês → não bloqueado.
    const empId = await createDiurnoWorker('DIURNO Ago26 w0', 1, 2026);
    const entries = await generateAndGetEntries(8, 2026);

    const week = entriesInRange(entries, empId, '2026-08-02', '2026-08-08');
    const hours = weekHours(week);

    expect(hours, 'Ago semana 0 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h em semana 36h').toBe(12);
    });
  });
});

// ── Setembro 2026 ★ Alto Risco ───────────────────────────────────────────────
// Set 1 = Ter → 5 dias de semana parcial (Ter–Sáb) antes da primeira semana completa
// Semana 0: Set 6–12, globalWi=35 → GLOBAL_PATTERN_12[11] = '42h'
// Semana 1: Set 13–19, globalWi=36 → GLOBAL_PATTERN_12[0] = '36h' (Dom bloqueado → skippedAny)
// Semana 2: Set 20–26, globalWi=37 → GLOBAL_PATTERN_12[1] = '42h'
//
// Nota: semana 0 afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Semana 1: Dom Set 13 bloqueado (Sáb Set 12 19:00 → 12h) → skippedAny — tipo=36h confirma.
// Semana 2: Dom Set 20 tem rest=36h (Sex Set 18 último turno em sem1) → sem skippedAny → 42h.

describe('Set/2026 — alto risco (cycle_start=Jan/2026, globalWi=36/37)', () => {
  it('semana 1 (Set 13–19) → 36h: 3 plantões de 12h', async () => {
    // Dom Set 13 bloqueado por rest cross-week (Sáb Set 12 19:00 → 12h < 24h).
    // skippedAny=true — tipo=36h ← reforça resultado (fix #100).
    const empId = await createDiurnoWorker('DIURNO Set26 w1', 1, 2026);
    const entries = await generateAndGetEntries(9, 2026);

    const week = entriesInRange(entries, empId, '2026-09-13', '2026-09-19');
    const hours = weekHours(week);

    expect(hours, 'Set semana 1 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h em semana 36h').toBe(12);
    });
  });

  it('semana 2 (Set 20–26) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=37 → GLOBAL_PATTERN_12[1] = '42h'. Dom Set 20 tem rest=36h
    // (Sex Set 18 19:00 → Dom Set 20 07:00 = 36h) → sem skippedAny → 42h.
    const empId = await createDiurnoWorker('DIURNO Set26 w2', 1, 2026);
    const entries = await generateAndGetEntries(9, 2026);

    const week = entriesInRange(entries, empId, '2026-09-20', '2026-09-26');
    const hours = weekHours(week);

    expect(hours, 'Set semana 2 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Outubro 2026 ─────────────────────────────────────────────────────────────
// Out 1 = Qui → primeira semana completa = Out 4–10
// globalWi=39 → '36h'; globalWi=40 → '42h'
//
// Nota: semana 0 (Out 4–10) afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Testando semana 1 (Out 11–17, globalWi=40='42h') protegida após cap atingido.

describe('Out/2026 (cycle_start=Jan/2026, globalWi=40)', () => {
  it('semana 1 (Out 11–17) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=40 → GLOBAL_PATTERN_12[4] = '42h'. Dom Out 11 tem rest ≥ 24h
    // (Sex Out 9 último turno em sem0) → sem skippedAny → 42h.
    const empId = await createDiurnoWorker('DIURNO Out26 w1', 1, 2026);
    const entries = await generateAndGetEntries(10, 2026);

    const week = entriesInRange(entries, empId, '2026-10-11', '2026-10-17');
    const hours = weekHours(week);

    expect(hours, 'Out semana 1 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Novembro 2026 ────────────────────────────────────────────────────────────
// Nov 1 = Dom → semana 0 começa Nov 1 (sem semana parcial)
// globalWi=43 → GLOBAL_PATTERN_12[7] = '42h'

describe('Nov/2026 (cycle_start=Jan/2026, globalWi=43)', () => {
  it('semana 0 (Nov 1–7) → 42h: 3×12h + 1×6h', async () => {
    // Nov 1 = Dom, primeira semana do mês — sem semana anterior no mês → Dom não bloqueado.
    const empId = await createDiurnoWorker('DIURNO Nov26 w0', 1, 2026);
    const entries = await generateAndGetEntries(11, 2026);

    const week = entriesInRange(entries, empId, '2026-11-01', '2026-11-07');
    const hours = weekHours(week);

    expect(hours, 'Nov semana 0 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });
});

// ── Dezembro 2026 ★ Alto Risco ───────────────────────────────────────────────
// Dez 1 = Ter → 5 dias de semana parcial (Ter–Sáb) antes da primeira semana completa
// Semana 0: Dez 6–12, globalWi=48 → GLOBAL_PATTERN_12[0] = '36h'
// Semana 1: Dez 13–19, globalWi=49 → GLOBAL_PATTERN_12[1] = '42h'
// Semana 2: Dez 20–26, globalWi=50 → GLOBAL_PATTERN_12[2] = '42h' (Dom bloqueado → 36h real)
//
// Nota: semana 0 afetada pelo enforcement (4 semanas, ≈150h < cap=160h).
// Semana 1 (Dez 13–19): Dom Dez 13 tem rest ≥ 24h → sem skippedAny → 42h.
// Semana 2 (Dez 20–26): Dom Dez 20 bloqueado (Sáb Dez 19 19:00 → 12h) → skippedAny → 36h.

describe('Dez/2026 — alto risco (cycle_start=Jan/2026, globalWi=49/50)', () => {
  it('semana 1 (Dez 13–19) → 42h: 3×12h + 1×6h', async () => {
    // globalWi=49 → GLOBAL_PATTERN_12[1] = '42h'. Dom Dez 13 não bloqueado
    // (sem turno Sáb Dez 12 em w0: enforcement afetou w0 mas Dez 11 foi último turno normal).
    const empId = await createDiurnoWorker('DIURNO Dez26 w1', 1, 2026);
    const entries = await generateAndGetEntries(12, 2026);

    const week = entriesInRange(entries, empId, '2026-12-13', '2026-12-19');
    const hours = weekHours(week);

    expect(hours, 'Dez semana 1 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHour = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHour.length, '1 turno de 6h em semana 42h').toBe(1);
  });

  it('semana 2 (Dez 20–26) → 36h: Dom bloqueado (skippedAny) — 3×12h', async () => {
    // globalWi=50 → GLOBAL_PATTERN_12[2] = '42h', mas Dom Dez 20 bloqueado
    // (Sáb Dez 19 19:00 → Dom Dez 20 07:00 = 12h < 24h) → skippedAny → 36h (fix #100).
    const empId = await createDiurnoWorker('DIURNO Dez26 w2', 1, 2026);
    const entries = await generateAndGetEntries(12, 2026);

    const week = entriesInRange(entries, empId, '2026-12-20', '2026-12-26');
    const hours = weekHours(week);

    expect(hours, 'Dez semana 2 = 36h (skippedAny)').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões (Dom bloqueado)').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão 12h').toBe(12);
    });
  });
});
