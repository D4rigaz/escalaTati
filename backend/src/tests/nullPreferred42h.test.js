/**
 * test(generator): null-preferred workers em semanas de 42h — bug #136
 *
 * Critérios de aceite (issue #136):
 *   - Motorista null-preferred em semana 42h: deve produzir 42h (3×12h + 1×6h Manhã/Tarde)
 *   - Motorista null-preferred em semana 36h: deve produzir 36h (3×12h)
 *   - Nunca duas semanas consecutivas de 36h quando uma delas é weekType='42h'
 *   - Validação para os 4 perfis: null-preferred, Noturno, Manhã, Tarde
 *   - Validação para 3 cycle_starts distintos (Jan, Mai, Set/2026)
 *
 * Calendário de referência — Abril 2026:
 *   Período: 05/04 (Dom) → 02/05 (Sáb) — 4 semanas completas
 *
 * Para cycle_start = Jan/2026 (cycleFirstSunday = 04/01/2026):
 *   Semana 0 (05/04–11/04): globalWi=13 → GLOBAL_PATTERN_12[1]  = '42h'
 *   Semana 1 (12/04–18/04): globalWi=14 → GLOBAL_PATTERN_12[2]  = '42h'
 *   Semana 2 (19/04–25/04): globalWi=15 → GLOBAL_PATTERN_12[3]  = '36h'
 *   Semana 3 (26/04–02/05): globalWi=16 → GLOBAL_PATTERN_12[4]  = '42h'
 *
 * Para cycle_start = Mai/2026 (cycleFirstSunday = 03/05/2026):
 *   Semana 0 (05/04–11/04): globalWi=-4 → GLOBAL_PATTERN_12[8]  = '42h'
 *   Semana 1 (12/04–18/04): globalWi=-3 → GLOBAL_PATTERN_12[9]  = '36h'
 *   Semana 2 (19/04–25/04): globalWi=-2 → GLOBAL_PATTERN_12[10] = '42h'
 *   Semana 3 (26/04–02/05): globalWi=-1 → GLOBAL_PATTERN_12[11] = '42h'
 *
 * Para cycle_start = Set/2026 (cycleFirstSunday = 06/09/2026):
 *   Semana 0 (05/04–11/04): globalWi=-22 → GLOBAL_PATTERN_12[2] = '42h'
 *   Semana 1 (12/04–18/04): globalWi=-21 → GLOBAL_PATTERN_12[3] = '36h'
 *   Semana 2 (19/04–25/04): globalWi=-20 → GLOBAL_PATTERN_12[4] = '42h'
 *   Semana 3 (26/04–02/05): globalWi=-19 → GLOBAL_PATTERN_12[5] = '42h'
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, createEmployee, shiftId } from './helpers.js';
import { generateSchedule } from '../services/scheduleGenerator.js';

const APR = { month: 4, year: 2026 };

// Semanas de Abril 2026 (Dom→Sáb)
const WEEK0 = ['2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-11'];
const WEEK1 = ['2026-04-12','2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17','2026-04-18'];
const WEEK2 = ['2026-04-19','2026-04-20','2026-04-21','2026-04-22','2026-04-23','2026-04-24','2026-04-25'];
const WEEK3 = ['2026-04-26','2026-04-27','2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02'];

beforeEach(() => freshDb());

function weeklyHours(entries, empId, weekDates) {
  return entries
    .filter((e) => e.employee_id === empId && weekDates.includes(e.date) && !e.is_day_off && e.duration_hours)
    .reduce((sum, e) => sum + e.duration_hours, 0);
}

async function generate() {
  const { results } = await generateSchedule(APR);
  // Busca entries do DB diretamente via generateSchedule (retornado em weekClassifications)
  return results;
}

// Helper: gera e lê entries do DB
function getEntries(db, empId) {
  return db.prepare(
    `SELECT se.employee_id, se.date, se.is_day_off,
            st.duration_hours
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ?
     ORDER BY se.date`
  ).all(empId);
}

function setCycleStart(db, empId, month, year) {
  db.prepare('UPDATE employees SET cycle_start_month = ?, cycle_start_year = ? WHERE id = ?')
    .run(month, year, empId);
}

// ── Suíte 1: null-preferred com cycle_start Jan/2026 ──────────────────────────
describe('null-preferred + cycle_start Jan/2026 — Abril 2026', () => {
  it('semana 0 (42h) deve produzir 42h, não 36h — bug #136', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    const h0 = weeklyHours(entries, emp.id, WEEK0);
    expect(h0).toBe(42);
  });

  it('semana 1 (42h) deve produzir 42h, não 36h — bug #136', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    const h1 = weeklyHours(entries, emp.id, WEEK1);
    expect(h1).toBe(42);
  });

  it('semana 2 (36h) deve produzir 36h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    const h2 = weeklyHours(entries, emp.id, WEEK2);
    expect(h2).toBe(36);
  });

  it('semana 3 (42h) deve produzir 42h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    const h3 = weeklyHours(entries, emp.id, WEEK3);
    expect(h3).toBe(42);
  });

  it('nunca duas semanas consecutivas de 36h — bug #136', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    const weeks = [WEEK0, WEEK1, WEEK2, WEEK3];
    const hoursPerWeek = weeks.map((w) => weeklyHours(entries, emp.id, w));

    for (let i = 0; i < hoursPerWeek.length - 1; i++) {
      if (hoursPerWeek[i] === 36 && hoursPerWeek[i + 1] === 36) {
        throw new Error(
          `Semanas consecutivas ${i} e ${i + 1} ambas com 36h — impossível com GLOBAL_PATTERN_12`
        );
      }
    }
  });
});

// ── Suíte 2: cycle_start Mai/2026 ─────────────────────────────────────────────
describe('null-preferred + cycle_start Mai/2026 — Abril 2026', () => {
  it('semana 0 (42h) deve produzir 42h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 5, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK0)).toBe(42);
  });

  it('semana 1 (36h) deve produzir 36h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 5, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK1)).toBe(36);
  });

  it('semana 2 (42h) deve produzir 42h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 5, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK2)).toBe(42);
  });
});

// ── Suíte 3: cycle_start Set/2026 ─────────────────────────────────────────────
describe('null-preferred + cycle_start Set/2026 — Abril 2026', () => {
  it('semana 0 (42h) deve produzir 42h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 9, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK0)).toBe(42);
  });

  it('semana 1 (36h) deve produzir 36h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Alex', preferredShiftId: null });
    setCycleStart(db, emp.id, 9, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK1)).toBe(36);
  });
});

// ── Suíte 4: outros perfis — Manhã/Tarde devem respeitar weekType ─────────────
describe('perfil Noturno + cycle_start Jan/2026 — Abril 2026', () => {
  it('semana 0 (42h) deve produzir 42h para motorista Noturno', async () => {
    const db = freshDb();
    const notId = shiftId(db, 'Noturno');
    const emp = createEmployee(db, { name: 'Carlos', preferredShiftId: notId });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK0)).toBe(42);
  });

  it('semana 1 (42h) deve produzir 42h para motorista Noturno', async () => {
    const db = freshDb();
    const notId = shiftId(db, 'Noturno');
    const emp = createEmployee(db, { name: 'Carlos', preferredShiftId: notId });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule(APR);

    const entries = getEntries(db, emp.id);
    expect(weeklyHours(entries, emp.id, WEEK1)).toBe(42);
  });
});
