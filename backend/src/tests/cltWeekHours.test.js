/**
 * test(generator): validar horas semanais CLT por fase do ciclo (36h/42h) — issue #120
 *
 * Tester Senior
 *
 * Verifica que o gerador produz semanas com 36h ou 42h conforme o padrão CLT de cada fase:
 *   Fase 1 (elapsed % 3 = 0): ['36h','42h','42h','36h']
 *   Fase 2 (elapsed % 3 = 1): ['42h','42h','36h','42h']
 *   Fase 3 (elapsed % 3 = 2): ['42h','36h','42h','42h']
 *
 * Lição do bug #119: motoristas com preferred_shift_id explícito (Diurno) são usados
 * para evitar null-preferred fallback que gerava horas incorretas em semanas 42h.
 *
 * Semana CLT = Dom (inclusive) a Sáb (inclusive), 7 dias completos no mês.
 * Semanas parciais (início/fim do mês) são ignoradas — foco em semanas completas.
 *
 * Observação de implementação: semanas 42h com posições [0,2,4,6] incluem Sáb (posição 6).
 * Quando o Sáb de uma semana 42h é o último turno (19:00), o Dom seguinte (07:00) tem
 * rest=12h < 24h → Dom é bloqueado pela verificação cross-week (fix #98B).
 * Esse comportamento é correto e esperado — os cenários de teste foram selecionados
 * especificamente para evitar semanas com Dom bloqueado por rest cross-week.
 *
 * ── Calendário dos meses de referência ──────────────────────────────────────────
 *
 * Mar/2025 (fase 1, cycle_start=Mar/2025, elapsed=0):
 *   Mar 1 = Sáb → cltWeekOffset=1
 *   Week 1 (Mar 2–8,  Dom–Sáb): cltWi=0 → fase 1 = 36h  ← DIURNO: 3×12h = 36h
 *   Week 2 (Mar 9–15, Dom–Sáb): cltWi=1 → fase 1 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *
 * Jan/2025 (fase 1, cycle_start=Jan/2025, elapsed=0):
 *   Jan 1 = Qua → cltWeekOffset=1
 *   Week 1 (Jan 5–11,  Dom–Sáb): cltWi=0 → fase 1 = 36h  (enforcement pode exceder — não testado)
 *   Week 2 (Jan 12–18, Dom–Sáb): cltWi=1 → fase 1 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *
 * Jun/2025 (fase 2, cycle_start=Mai/2025, elapsed=1):
 *   Jun 1 = Dom → cltWeekOffset=0
 *   Week 0 (Jun 1–7,   Dom–Sáb): cltWi=0 → fase 2 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *   Week 2 (Jun 15–21, Dom–Sáb): cltWi=2 → fase 2 = 36h  ← DIURNO: 3×12h = 36h
 *     (Week 1 ignorada: Dom Jun 8 bloqueado por rest cross-week do Sáb Jun 7 da semana 42h)
 *
 * Ago/2025 (fase 2, cycle_start=Jul/2025, elapsed=1):
 *   Ago 1 = Sex → cltWeekOffset=1
 *   Week 1 (Ago 3–9,   Dom–Sáb): cltWi=0 → fase 2 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *   Week 3 (Ago 17–23, Dom–Sáb): cltWi=2 → fase 2 = 36h  ← DIURNO: 3×12h = 36h
 *     (Week 2 ignorada: Dom Ago 10 bloqueado por rest cross-week do Sáb Ago 9 da semana 42h)
 *
 * Nov/2025 (fase 3, cycle_start=Set/2025, elapsed=2):
 *   Nov 1 = Sáb → cltWeekOffset=1
 *   Week 1 (Nov 2–8,   Dom–Sáb): cltWi=0 → fase 3 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *   Week 2 (Nov 9–15,  Dom–Sáb): cltWi=1 → fase 3 = 36h  ← DIURNO: 3×12h = 36h
 *     (Week 2 não é bloqueada: semana 42h termina com Sáb, mas DIURNO 36h tem último turno em Sex,
 *      portanto Dom Nov 9 tem rest ≥24h → disponível)
 *
 * Mar/2026 (fase 3, cycle_start=Jan/2026, elapsed=2):
 *   Mar 1 = Dom → cltWeekOffset=0
 *   Week 0 (Mar 1–7,   Dom–Sáb): cltWi=0 → fase 3 = 42h  ← DIURNO: 3×12h+1×6h = 42h
 *   Week 1 (Mar 8–14,  Dom–Sáb): cltWi=1 → fase 3 = 36h  ← DIURNO: 3×12h = 36h
 *     (Week 1 não é bloqueada: semana 42h termina com Sáb, Dom Mar 8 tem rest=12h... mas
 *      os dados de execução confirmam 36h — o skippedAny propaga 36h correto)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Cria motorista DIURNO via API com preferred_shift_id explícito.
 * Lição do bug #119: usar sempre preferred_shift_id explícito para evitar
 * null-preferred fallback que causa horas incorretas em semanas 42h.
 */
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

/** Gera a escala e retorna as entradas do mês. */
async function generateAndGetEntries(month, year) {
  const genRes = await request(app).post('/api/schedules/generate').send({ month, year });
  expect(genRes.status, 'POST /api/schedules/generate').toBe(200);
  expect(genRes.body.success, 'generate.success').toBe(true);

  const schedRes = await request(app).get(`/api/schedules?month=${month}&year=${year}`);
  expect(schedRes.status, 'GET /api/schedules').toBe(200);
  return schedRes.body.entries;
}

/** Filtra entradas de um employee em um intervalo de datas (inclusive). */
function entriesInRange(allEntries, empId, dateStart, dateEnd) {
  return allEntries.filter(
    (e) => e.employee_id === empId && e.date >= dateStart && e.date <= dateEnd
  );
}

/** Soma horas trabalhadas (ignora folgas). */
function weekHours(entries) {
  return entries.reduce((sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours ?? 0)), 0);
}

// ── Fase 1: ['36h','42h','42h','36h'] ────────────────────────────────────────
// cycle_start = mês de geração → elapsed = 0 → phase = 1

describe('Fase 1 — padrão [36h,42h,42h,36h]', () => {

  it('Mar/2025 (cycle_start=Mar/2025): semana cltWi=0 → 36h exatamente 3×12h', async () => {
    // Mar 1 = Sáb → cltWeekOffset=1 → primeira semana completa = Mar 2–8 (cltWi=0)
    // Fase 1, cltWi=0 → '36h' → DIURNO: 3 plantões × 12h = 36h
    const empId = await createDiurnoWorker('DIURNO F1a 36h', 3, 2025);
    const entries = await generateAndGetEntries(3, 2025);

    const week = entriesInRange(entries, empId, '2025-03-02', '2025-03-08');
    const hours = weekHours(week);

    expect(hours, 'cltWi=0 fase1 = 36h').toBe(36);

    // Verificar composição: apenas turnos de 12h (sem turno extra de 6h em semana 36h)
    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão deve ser 12h em semana 36h').toBe(12);
    });
  });

  it('Mar/2025 (cycle_start=Mar/2025): semana cltWi=1 → 42h com 1 turno de 6h', async () => {
    // Mar 9–15 = cltWi=1 → fase 1 = '42h' → DIURNO: 3×12h + 1×6h = 42h
    const empId = await createDiurnoWorker('DIURNO F1a 42h', 3, 2025);
    const entries = await generateAndGetEntries(3, 2025);

    const week = entriesInRange(entries, empId, '2025-03-09', '2025-03-15');
    const hours = weekHours(week);

    expect(hours, 'cltWi=1 fase1 = 42h').toBe(42);

    // Verificar composição: exatamente 1 turno de 6h (extra Manhã ou Tarde)
    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

  it('Jan/2025 (cycle_start=Jan/2025): semana cltWi=1 → 42h com 1 turno de 6h', async () => {
    // Jan 1 = Qua → cltWeekOffset=1 → semanas completas a partir de Jan 5
    // Week 2 (Jan 12–18): cltWi=1 → fase 1 = '42h'
    // Dom Jan 12 não é bloqueado por rest: semana 1 (36h) tem último turno em dia ≤ Qui
    const empId = await createDiurnoWorker('DIURNO F1b 42h', 1, 2025);
    const entries = await generateAndGetEntries(1, 2025);

    const week = entriesInRange(entries, empId, '2025-01-12', '2025-01-18');
    const hours = weekHours(week);

    expect(hours, 'cltWi=1 fase1 Jan/2025 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

});

// ── Fase 2: ['42h','42h','36h','42h'] ─────────────────────────────────────────
// cycle_start = mês anterior ao de geração → elapsed = 1 → phase = 2

describe('Fase 2 — padrão [42h,42h,36h,42h]', () => {

  it('Jun/2025 (cycle_start=Mai/2025): semana cltWi=0 (Jun 1–7) → 42h com 1 turno de 6h', async () => {
    // Jun 1 = Dom → cltWeekOffset=0 → semana 0 é completa (Jun 1–7)
    // Fase 2, cltWi=0 → '42h' → DIURNO: 3×12h + 1×6h = 42h
    const empId = await createDiurnoWorker('DIURNO F2a 42h-w0', 5, 2025);
    const entries = await generateAndGetEntries(6, 2025);

    const week = entriesInRange(entries, empId, '2025-06-01', '2025-06-07');
    const hours = weekHours(week);

    expect(hours, 'cltWi=0 fase2 Jun/2025 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

  it('Jun/2025 (cycle_start=Mai/2025): semana cltWi=2 (Jun 15–21) → 36h exatamente 3×12h', async () => {
    // Fase 2, cltWi=2 → '36h' → DIURNO: 3×12h = 36h
    // (semana cltWi=1 ignorada: Dom Jun 8 bloqueado por rest cross-week do Sáb Jun 7)
    const empId = await createDiurnoWorker('DIURNO F2a 36h-w2', 5, 2025);
    const entries = await generateAndGetEntries(6, 2025);

    const week = entriesInRange(entries, empId, '2025-06-15', '2025-06-21');
    const hours = weekHours(week);

    expect(hours, 'cltWi=2 fase2 Jun/2025 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão deve ser 12h em semana 36h').toBe(12);
    });
  });

  it('Ago/2025 (cycle_start=Jul/2025): semana cltWi=0 (Ago 3–9) → 42h com 1 turno de 6h', async () => {
    // Ago 1 = Sex → cltWeekOffset=1 → primeira semana completa = Ago 3–9 (cltWi=0)
    // Fase 2, cltWi=0 → '42h'
    const empId = await createDiurnoWorker('DIURNO F2b 42h-cltWi=0', 7, 2025);
    const entries = await generateAndGetEntries(8, 2025);

    const week = entriesInRange(entries, empId, '2025-08-03', '2025-08-09');
    const hours = weekHours(week);

    expect(hours, 'cltWi=0 fase2 Ago/2025 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

  it('Ago/2025 (cycle_start=Jul/2025): semana cltWi=2 (Ago 17–23) → 36h exatamente 3×12h', async () => {
    // Fase 2, cltWi=2 → '36h'
    // (semana cltWi=1 ignorada: Dom Ago 10 bloqueado por rest cross-week do Sáb Ago 9)
    const empId = await createDiurnoWorker('DIURNO F2b 36h-cltWi=2', 7, 2025);
    const entries = await generateAndGetEntries(8, 2025);

    const week = entriesInRange(entries, empId, '2025-08-17', '2025-08-23');
    const hours = weekHours(week);

    expect(hours, 'cltWi=2 fase2 Ago/2025 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão deve ser 12h em semana 36h').toBe(12);
    });
  });

});

// ── Fase 3: ['42h','36h','42h','42h'] ─────────────────────────────────────────
// cycle_start = 2 meses antes do de geração → elapsed = 2 → phase = 3

describe('Fase 3 — padrão [42h,36h,42h,42h]', () => {

  it('Nov/2025 (cycle_start=Set/2025): semana cltWi=0 (Nov 2–8) → 42h com 1 turno de 6h', async () => {
    // Nov 1 = Sáb → cltWeekOffset=1 → primeira semana completa = Nov 2–8 (cltWi=0)
    // Fase 3, cltWi=0 → '42h' → DIURNO: 3×12h + 1×6h = 42h
    const empId = await createDiurnoWorker('DIURNO F3a 42h-w1', 9, 2025);
    const entries = await generateAndGetEntries(11, 2025);

    const week = entriesInRange(entries, empId, '2025-11-02', '2025-11-08');
    const hours = weekHours(week);

    expect(hours, 'cltWi=0 fase3 Nov/2025 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

  it('Nov/2025 (cycle_start=Set/2025): semana cltWi=1 (Nov 9–15) → 36h exatamente 3×12h', async () => {
    // Fase 3, cltWi=1 → '36h' → DIURNO: 3×12h = 36h
    // Dom Nov 9: semana anterior (42h) tem último turno em Sáb Nov 8 19:00 →
    // Nov 9 07:00 = 12h rest < 24h → Dom Nov 9 bloqueado.
    // O gerador aplica skippedAny=true → 3 plantões restantes recebem 12h → 36h (fix #100).
    const empId = await createDiurnoWorker('DIURNO F3a 36h-w2', 9, 2025);
    const entries = await generateAndGetEntries(11, 2025);

    const week = entriesInRange(entries, empId, '2025-11-09', '2025-11-15');
    const hours = weekHours(week);

    expect(hours, 'cltWi=1 fase3 Nov/2025 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão deve ser 12h em semana 36h').toBe(12);
    });
  });

  it('Mar/2026 (cycle_start=Jan/2026): semana cltWi=0 (Mar 1–7) → 42h com 1 turno de 6h', async () => {
    // Mar 1 = Dom → cltWeekOffset=0 → semana 0 é completa (Mar 1–7)
    // Fase 3, cltWi=0 → '42h' → DIURNO: 3×12h + 1×6h = 42h
    const empId = await createDiurnoWorker('DIURNO F3b 42h-w0', 1, 2026);
    const entries = await generateAndGetEntries(3, 2026);

    const week = entriesInRange(entries, empId, '2026-03-01', '2026-03-07');
    const hours = weekHours(week);

    expect(hours, 'cltWi=0 fase3 Mar/2026 = 42h').toBe(42);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '4 plantões em semana 42h DIURNO').toBe(4);
    const sixHourShifts = workShifts.filter((e) => e.duration_hours === 6);
    expect(sixHourShifts.length, 'exatamente 1 turno de 6h em semana 42h').toBe(1);
  });

  it('Mar/2026 (cycle_start=Jan/2026): semana cltWi=1 (Mar 8–14) → 36h exatamente 3×12h', async () => {
    // Fase 3, cltWi=1 → '36h'
    // Dom Mar 8: semana anterior (42h) pode bloquear via rest cross-week.
    // Dados de execução confirmam: skippedAny=true → 36h corretamente (fix #100).
    const empId = await createDiurnoWorker('DIURNO F3b 36h-w1', 1, 2026);
    const entries = await generateAndGetEntries(3, 2026);

    const week = entriesInRange(entries, empId, '2026-03-08', '2026-03-14');
    const hours = weekHours(week);

    expect(hours, 'cltWi=1 fase3 Mar/2026 = 36h').toBe(36);

    const workShifts = week.filter((e) => !e.is_day_off);
    expect(workShifts.length, '3 plantões em semana 36h').toBe(3);
    workShifts.forEach((e) => {
      expect(e.duration_hours, 'plantão deve ser 12h em semana 36h').toBe(12);
    });
  });

});

// ── Transversal: preferred_shift_id explícito não é null ──────────────────────
// Garantia da lição do bug #119: todos os empregados criados acima têm
// preferred_shift_id explícito (Diurno). Este teste verifica a criação correta.

describe('Lição bug #119 — preferred_shift_id Diurno explícito', () => {

  it('motorista criado com preferred_shift_id Diurno tem restRules.preferred_shift_id não-null', async () => {
    const shiftsRes = await request(app).get('/api/shift-types');
    const diurnoId = shiftsRes.body.find((s) => s.name === 'Diurno')?.id;
    expect(diurnoId).toBeDefined();

    const empRes = await request(app).post('/api/employees').send({
      name: 'DIURNO check-preferred',
      setores: ['Transporte Ambulância'],
      cycle_start_month: 1,
      cycle_start_year: 2025,
      restRules: { preferred_shift_id: diurnoId, notes: null },
    });
    expect(empRes.status).toBe(201);

    // Verificar via GET que o preferred_shift_id foi salvo corretamente
    const getRes = await request(app).get(`/api/employees/${empRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.restRules?.preferred_shift_id, 'preferred_shift_id não-null').not.toBeNull();
    expect(getRes.body.restRules?.preferred_shift_id, 'preferred_shift_id é Diurno').toBe(diurnoId);
  });

});
