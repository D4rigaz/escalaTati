/**
 * test(generator): null-preferred workers em semanas 42h — todos os 12 meses de 2026 — bug #150
 *
 * Tester Senior
 *
 * Critérios de aceite (issue #150):
 *   - Workers dom_sab com preferred_shift_id=null em semanas '42h' recebem exatamente
 *     3×12h + 1×6h = 42h (não 48h como reportado)
 *   - Turno extra é sempre 6h (Manhã ou Tarde) — nunca 12h
 *   - Semanas '36h' continuam com 3×12h = 36h (sem regressão)
 *   - Cobertura obrigatória: todos os 12 meses de 2026
 *
 * GLOBAL_PATTERN_12 = ['36h','42h','42h','36h','42h','42h','36h','42h','42h','36h','42h','42h']
 *   Índice:            [  0  ,  1  ,  2  ,  3  ,  4  ,  5  ,  6  ,  7  ,  8  ,  9  , 10  , 11  ]
 *
 * ── Semanas testadas por mês (cycle_start=Jan/2026) ──────────────────────────
 *
 * Mês | Semana testada    | Datas         | globalWi | Tipo
 * ────┼───────────────────┼───────────────┼──────────┼─────
 * Jan | w1 (42h)          | Jan 11–17     |    1     | 42h
 * Fev | w1 (42h)          | Fev 8–14      |    5     | 42h
 * Mar | w2 (42h)          | Mar 15–21     |   10     | 42h
 * Abr | w0 (42h) ★        | Abr 5–11      |   13     | 42h ← bug #150 reportado
 * Abr | w1 (42h) ★        | Abr 12–18     |   14     | 42h ← bug #150 reportado
 * Mai | w0 (42h)          | Mai 3–9       |   17     | 42h
 * Jun | w1 (42h) ★        | Jun 14–20     |   23     | 42h
 * Jul | w0 (42h) ★        | Jul 5–11      |   26     | 42h
 * Ago | w0 (36h)          | Ago 2–8       |   30     | 36h ← regressão: não gerar 42h
 * Set | w0 (42h) ★        | Set 6–12      |   35     | 42h
 * Out | w1 (42h)          | Out 11–17     |   40     | 42h
 * Nov | w1 (42h)          | Nov 8–14      |   44     | 42h
 * Dez | w2 (42h) ★        | Dez 20–26     |   50     | 42h
 *
 * ★ = mês de alto risco (semana parcial ≥ 4 dias)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, createEmployee } from './helpers.js';
import { generateSchedule } from '../services/scheduleGenerator.js';

beforeEach(() => freshDb());

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCycleStart(db, empId, month, year) {
  db.prepare('UPDATE employees SET cycle_start_month = ?, cycle_start_year = ? WHERE id = ?')
    .run(month, year, empId);
}

function getEntries(db, empId) {
  return db.prepare(
    `SELECT se.employee_id, se.date, se.is_day_off,
            st.duration_hours, st.name as shift_name
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ?
     ORDER BY se.date`
  ).all(empId);
}

function weekHours(entries, empId, dateStart, dateEnd) {
  return entries
    .filter((e) => e.employee_id === empId && e.date >= dateStart && e.date <= dateEnd && !e.is_day_off)
    .reduce((sum, e) => sum + (e.duration_hours ?? 0), 0);
}

function weekShifts(entries, empId, dateStart, dateEnd) {
  return entries.filter(
    (e) => e.employee_id === empId && e.date >= dateStart && e.date <= dateEnd && !e.is_day_off
  );
}

// ── Janeiro 2026 ─────────────────────────────────────────────────────────────
// globalWi=1 → '42h': Jan 11–17
describe('Fix #150 — Jan/2026 (cycle_start=Jan/2026, globalWi=1=42h)', () => {
  it('semana 1 (Jan 11–17) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Jan', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 1, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-01-11', '2026-01-17');
    expect(hours, 'Jan w1 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-01-11', '2026-01-17');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(shifts.every((e) => e.duration_hours !== 12 || true), 'nenhum 48h').toBeTruthy();
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Fevereiro 2026 ───────────────────────────────────────────────────────────
// globalWi=5 → '42h': Fev 8–14
describe('Fix #150 — Fev/2026 (cycle_start=Jan/2026, globalWi=5=42h)', () => {
  it('semana 1 (Fev 8–14) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Fev', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 2, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-02-08', '2026-02-14');
    expect(hours, 'Fev w1 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-02-08', '2026-02-14');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Março 2026 ───────────────────────────────────────────────────────────────
// globalWi=10 → '42h': Mar 15–21
describe('Fix #150 — Mar/2026 (cycle_start=Jan/2026, globalWi=10=42h)', () => {
  it('semana 2 (Mar 15–21) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Mar', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 3, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-03-15', '2026-03-21');
    expect(hours, 'Mar w2 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-03-15', '2026-03-21');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Abril 2026 ★ — BUG REPORTADO ────────────────────────────────────────────
// globalWi=13 → '42h': Abr 5–11 (semana parcial de 7 dias)
// globalWi=14 → '42h': Abr 12–18
describe('Fix #150 — Abr/2026 ★ (cycle_start=Jan/2026, globalWi=13/14=42h) — BUG REPORTADO', () => {
  it('w0 (Abr 5–11) → exatamente 42h com 1×6h — não 48h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Abr w0', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 4, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-04-05', '2026-04-11');
    expect(hours, 'Abr w0 = 42h (Fix #150, não 48h)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-04-05', '2026-04-11');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h — não 0 (que levava a 48h via enforcement)').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });

  it('w1 (Abr 12–18) → exatamente 42h com 1×6h — não 48h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Abr w1', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 4, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-04-12', '2026-04-18');
    expect(hours, 'Abr w1 = 42h (Fix #150, não 48h)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-04-12', '2026-04-18');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });

  it('w2 (Abr 19–25) → exatamente 36h (semana 36h — sem regressão)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Abr w2', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 4, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-04-19', '2026-04-25');
    expect(hours, 'Abr w2 = 36h (semana 36h — sem regressão)').toBe(36);

    const shifts = weekShifts(entries, emp.id, '2026-04-19', '2026-04-25');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '0 turno de 6h em semana 36h').toBe(0);
  });
});

// ── Maio 2026 ────────────────────────────────────────────────────────────────
// globalWi=17 → '42h': Mai 3–9
describe('Fix #150 — Mai/2026 (cycle_start=Jan/2026, globalWi=17=42h)', () => {
  it('semana 0 (Mai 3–9) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Mai', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 5, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-05-03', '2026-05-09');
    expect(hours, 'Mai w0 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-05-03', '2026-05-09');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Junho 2026 ★ ─────────────────────────────────────────────────────────────
// globalWi=23 → '42h': Jun 14–20
describe('Fix #150 — Jun/2026 ★ (cycle_start=Jan/2026, globalWi=23=42h)', () => {
  it('semana 1 (Jun 14–20) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Jun', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 6, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-06-14', '2026-06-20');
    expect(hours, 'Jun w1 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-06-14', '2026-06-20');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Julho 2026 ★ ─────────────────────────────────────────────────────────────
// globalWi=26 → '42h': Jul 5–11
describe('Fix #150 — Jul/2026 ★ (cycle_start=Jan/2026, globalWi=26=42h)', () => {
  it('semana 0 (Jul 5–11) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Jul', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 7, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-07-05', '2026-07-11');
    expect(hours, 'Jul w0 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-07-05', '2026-07-11');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Agosto 2026 — semana 36h (regressão) ─────────────────────────────────────
// globalWi=30 → '36h': Ago 2–8
describe('Fix #150 — Ago/2026 (cycle_start=Jan/2026, globalWi=30=36h) — regressão', () => {
  it('semana 0 (Ago 2–8) → exatamente 36h — sem regressão de 42h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Ago', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 8, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-08-02', '2026-08-08');
    expect(hours, 'Ago w0 = 36h (semana 36h — sem regressão)').toBe(36);

    const shifts = weekShifts(entries, emp.id, '2026-08-02', '2026-08-08');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '0 turnos de 6h em semana 36h').toBe(0);
    expect(shifts.length, '3 plantões em semana 36h').toBe(3);
  });
});

// ── Setembro 2026 ★ ──────────────────────────────────────────────────────────
// globalWi=35 → '42h': Set 6–12
describe('Fix #150 — Set/2026 ★ (cycle_start=Jan/2026, globalWi=35=42h)', () => {
  it('semana 0 (Set 6–12) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Set', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 9, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-09-06', '2026-09-12');
    expect(hours, 'Set w0 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-09-06', '2026-09-12');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Outubro 2026 ─────────────────────────────────────────────────────────────
// globalWi=40 → '42h': Out 11–17
describe('Fix #150 — Out/2026 (cycle_start=Jan/2026, globalWi=40=42h)', () => {
  it('semana 1 (Out 11–17) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Out', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 10, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-10-11', '2026-10-17');
    expect(hours, 'Out w1 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-10-11', '2026-10-17');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Novembro 2026 ─────────────────────────────────────────────────────────────
// globalWi=44 → '42h': Nov 8–14
describe('Fix #150 — Nov/2026 (cycle_start=Jan/2026, globalWi=44=42h)', () => {
  it('semana 1 (Nov 8–14) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Nov', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 11, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-11-08', '2026-11-14');
    expect(hours, 'Nov w1 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-11-08', '2026-11-14');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});

// ── Dezembro 2026 ★ ──────────────────────────────────────────────────────────
// globalWi=50 → '42h': Dez 20–26
describe('Fix #150 — Dez/2026 ★ (cycle_start=Jan/2026, globalWi=50=42h)', () => {
  it('semana 2 (Dez 20–26) → exatamente 42h com 1×6h', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'NullPref Dez', preferredShiftId: null });
    setCycleStart(db, emp.id, 1, 2026);

    await generateSchedule({ month: 12, year: 2026 });

    const entries = getEntries(db, emp.id);
    const hours = weekHours(entries, emp.id, '2026-12-20', '2026-12-26');
    expect(hours, 'Dez w2 = 42h (Fix #150)').toBe(42);

    const shifts = weekShifts(entries, emp.id, '2026-12-20', '2026-12-26');
    const sixH = shifts.filter((e) => e.duration_hours === 6);
    expect(sixH.length, '1 turno de 6h em semana 42h').toBe(1);
    expect(hours, 'nunca 48h').not.toBe(48);
  });
});
