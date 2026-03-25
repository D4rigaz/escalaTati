/**
 * test(generator): Noturno w0 recovery em meses de 5 semanas — todos os 12 meses de 2026 — bug #146
 *
 * Tester Senior
 *
 * Critérios de aceite (issue #146):
 *   - Workers Noturno dom_sab em semanas '42h' recebem pelo menos 42h
 *   - Workers Noturno dom_sab em semanas '36h' recebem pelo menos 36h
 *   - Meses de 5 semanas (Mar, Mai, Ago, Nov): w0 exato — 42h ou 36h conforme semana CLT
 *   - Meses de 4 semanas: w0 ≥ 36h / ≥ 42h (enforcement pode adicionar, não remover)
 *   - Cobertura obrigatória: todos os 12 meses de 2026
 *
 * Root cause (Fix #146):
 *   selectOffDays com workStart alto (empId % 7 ∈ {1..4}) seleciona dias consecutivos no fim
 *   da semana → Noturno d1 termina 07:00 d2, d2 tem rest=12h → bloqueado, d3 OK.
 *   Recovery loop encontra candidatos em selectedOff (início da semana, datas anteriores ao
 *   trabalho colocado): candidateStart < lastShiftEnd → cross-semana → preceding=null →
 *   effectiveLastShiftEnd = lastShiftEnd (futuro) → rest negativo → todos rejeitados → 24h.
 *   Fix: quando preceding=null, effectiveLastShiftEnd=null (rest=Infinity); hasAdequateRest
 *   valida constraint forward corretamente.
 *
 * GLOBAL_PATTERN_12 = ['36h','42h','42h','36h','42h','42h','36h','42h','42h','36h','42h','42h']
 *   Índice:            [  0  ,  1  ,  2  ,  3  ,  4  ,  5  ,  6  ,  7  ,  8  ,  9  , 10  , 11  ]
 *
 * ── Tabela w0 por mês (2026, cycle_start=Jan/2026) ──────────────────────────
 *
 * Mês │ w0 (Dom–Sáb)  │ globalWi │ Tipo │ 5 sem │ Bug?   │ Asserção
 * ────┼───────────────┼──────────┼──────┼───────┼────────┼─────────
 * Jan │ Jan  4–10     │    0     │  36h │  não  │        │ ≥ 36h
 * Fev │ Fev  1–7      │    4     │  42h │  não  │        │ ≥ 42h
 * Mar │ Mar  1–7      │    8     │  42h │  sim  │ 24h/30h│ = 42h ★
 * Abr │ Abr  5–11     │   13     │  42h │  não  │        │ ≥ 42h
 * Mai │ Mai  3–9      │   17     │  42h │  sim  │ 24h/30h│ = 42h ★
 * Jun │ Jun  7–13     │   22     │  42h │  não  │        │ ≥ 42h
 * Jul │ Jul  5–11     │   26     │  42h │  não  │        │ ≥ 42h
 * Ago │ Ago  2–8      │   30     │  36h │  sim  │ 24h    │ = 36h ★
 * Set │ Set  6–12     │   35     │  42h │  não  │        │ ≥ 42h
 * Out │ Out  4–10     │   39     │  36h │  não  │        │ ≥ 36h
 * Nov │ Nov  1–7      │   43     │  42h │  sim  │ 24h/30h│ = 42h ★
 * Dez │ Dez  6–12     │   48     │  36h │  não  │        │ ≥ 36h
 *
 * ★ = mês de 5 semanas — asserção exata (bug principal); meses de 4 semanas usam ≥
 *     porque enforceDailyCoverage pode acrescentar turnos extras em dias de baixa cobertura.
 *
 * Trabalhadores criados: 4 Noturno dom_sab (IDs 1–4).
 * empId % 7 ∈ {1,2,3,4} → workStart alto → dias consecutivos → recovery necessário.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, createEmployee, shiftId } from './helpers.js';
import { generateSchedule } from '../services/scheduleGenerator.js';

let db;

beforeEach(() => {
  db = freshDb();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCycleStart(empId, month, year) {
  db.prepare('UPDATE employees SET cycle_start_month = ?, cycle_start_year = ? WHERE id = ?')
    .run(month, year, empId);
}

function getEntries(empId) {
  return db.prepare(
    `SELECT se.employee_id, se.date, se.is_day_off,
            st.duration_hours, st.name as shift_name
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ?
     ORDER BY se.date`
  ).all(empId);
}

function weekHours(entries, dateStart, dateEnd) {
  return entries
    .filter((e) => e.date >= dateStart && e.date <= dateEnd && !e.is_day_off)
    .reduce((sum, e) => sum + (e.duration_hours ?? 0), 0);
}

/** Cria 4 workers Noturno (IDs 1–4) e define cycle_start para todos. */
function createNoturnoWorkers(cycleStartMonth, cycleStartYear) {
  const noturnoId = shiftId(db, 'Noturno');
  expect(noturnoId, 'turno Noturno deve existir no seed').toBeDefined();

  const workers = [];
  for (let i = 1; i <= 4; i++) {
    const emp = createEmployee(db, {
      name: `Noturno W${i}`,
      preferredShiftId: noturnoId,
    });
    setCycleStart(emp.id, cycleStartMonth, cycleStartYear);
    workers.push(emp);
  }
  return workers;
}

// ── Janeiro 2026 — 4 semanas ──────────────────────────────────────────────────
// w0: Jan 4–10 | globalWi=0 → '36h' | sem bug; enforce pode adicionar → ≥ 36h
describe('Fix #146 — Jan/2026 w0 (Jan 4–10, globalWi=0=36h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 36h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 1, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-01-04', '2026-01-10');
      expect(hours, `${w.name} w0 Jan ≥ 36h`).toBeGreaterThanOrEqual(36);
    }
  });
});

// ── Fevereiro 2026 — 4 semanas ────────────────────────────────────────────────
// w0: Fev 1–7 | globalWi=4 → '42h' | sem bug; enforce pode adicionar → ≥ 42h
describe('Fix #146 — Fev/2026 w0 (Fev 1–7, globalWi=4=42h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 42h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 2, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-02-01', '2026-02-07');
      expect(hours, `${w.name} w0 Fev ≥ 42h`).toBeGreaterThanOrEqual(42);
    }
  });
});

// ── Março 2026 ★ — 5 semanas — BUG PRINCIPAL ─────────────────────────────────
// w0: Mar 1–7 | globalWi=8 → '42h' | 5 semanas ← BUG REPORTADO: 24h/30h → 42h
// Workers com empId%7∈{1..4}: selectedWork picks consecutive days → recovery bloqueado
describe('Fix #146 — Mar/2026 w0 (Mar 1–7, globalWi=8=42h, 5 semanas)', () => {
  it('todos os 4 workers Noturno recebem exatamente 42h em w0 (não 30h/24h)', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 3, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-03-01', '2026-03-07');
      expect(hours, `${w.name} w0 Mar ≠ 30h (bug #146)`).not.toBe(30);
      expect(hours, `${w.name} w0 Mar ≠ 24h (bug #146)`).not.toBe(24);
      expect(hours, `${w.name} w0 Mar = 42h`).toBe(42);
    }
  });
});

// ── Abril 2026 — 4 semanas ────────────────────────────────────────────────────
// w0: Abr 5–11 | globalWi=13 → '42h' | sem bug de 5-semanas → ≥ 42h
describe('Fix #146 — Abr/2026 w0 (Abr 5–11, globalWi=13=42h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 42h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 4, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-04-05', '2026-04-11');
      expect(hours, `${w.name} w0 Abr ≥ 42h`).toBeGreaterThanOrEqual(42);
    }
  });
});

// ── Maio 2026 ★ — 5 semanas — BUG ────────────────────────────────────────────
// w0: Mai 3–9 | globalWi=17 → '42h' | 5 semanas ← BUG: 24h/30h → 42h
describe('Fix #146 — Mai/2026 w0 (Mai 3–9, globalWi=17=42h, 5 semanas)', () => {
  it('todos os 4 workers Noturno recebem exatamente 42h em w0 (não 30h/24h)', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 5, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-05-03', '2026-05-09');
      expect(hours, `${w.name} w0 Mai ≠ 30h (bug #146)`).not.toBe(30);
      expect(hours, `${w.name} w0 Mai ≠ 24h (bug #146)`).not.toBe(24);
      expect(hours, `${w.name} w0 Mai = 42h`).toBe(42);
    }
  });
});

// ── Junho 2026 — 4 semanas ────────────────────────────────────────────────────
// w0: Jun 7–13 | globalWi=22 → '42h' | sem bug → ≥ 42h
describe('Fix #146 — Jun/2026 w0 (Jun 7–13, globalWi=22=42h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 42h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 6, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-06-07', '2026-06-13');
      expect(hours, `${w.name} w0 Jun ≥ 42h`).toBeGreaterThanOrEqual(42);
    }
  });
});

// ── Julho 2026 — 4 semanas ────────────────────────────────────────────────────
// w0: Jul 5–11 | globalWi=26 → '42h' | sem bug → ≥ 42h
describe('Fix #146 — Jul/2026 w0 (Jul 5–11, globalWi=26=42h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 42h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 7, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-07-05', '2026-07-11');
      expect(hours, `${w.name} w0 Jul ≥ 42h`).toBeGreaterThanOrEqual(42);
    }
  });
});

// ── Agosto 2026 ★ — 5 semanas — BUG ─────────────────────────────────────────
// w0: Ago 2–8 | globalWi=30 → '36h' | 5 semanas ← BUG: 24h → 36h
describe('Fix #146 — Ago/2026 w0 (Ago 2–8, globalWi=30=36h, 5 semanas)', () => {
  it('todos os 4 workers Noturno recebem exatamente 36h em w0 (não 24h)', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 8, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-08-02', '2026-08-08');
      expect(hours, `${w.name} w0 Ago ≠ 24h (bug #146)`).not.toBe(24);
      expect(hours, `${w.name} w0 Ago = 36h`).toBe(36);
    }
  });
});

// ── Setembro 2026 — 4 semanas ─────────────────────────────────────────────────
// w0: Set 6–12 | globalWi=35 → '42h' | sem bug → ≥ 42h
describe('Fix #146 — Set/2026 w0 (Set 6–12, globalWi=35=42h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 42h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 9, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-09-06', '2026-09-12');
      expect(hours, `${w.name} w0 Set ≥ 42h`).toBeGreaterThanOrEqual(42);
    }
  });
});

// ── Outubro 2026 — 4 semanas ─────────────────────────────────────────────────
// w0: Out 4–10 | globalWi=39 → '36h' | sem bug → ≥ 36h
describe('Fix #146 — Out/2026 w0 (Out 4–10, globalWi=39=36h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 36h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 10, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-10-04', '2026-10-10');
      expect(hours, `${w.name} w0 Out ≥ 36h`).toBeGreaterThanOrEqual(36);
    }
  });
});

// ── Novembro 2026 ★ — 5 semanas — BUG ────────────────────────────────────────
// w0: Nov 1–7 | globalWi=43 → '42h' | 5 semanas ← BUG: 24h/30h → 42h
describe('Fix #146 — Nov/2026 w0 (Nov 1–7, globalWi=43=42h, 5 semanas)', () => {
  it('todos os 4 workers Noturno recebem exatamente 42h em w0 (não 30h/24h)', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 11, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-11-01', '2026-11-07');
      expect(hours, `${w.name} w0 Nov ≠ 30h (bug #146)`).not.toBe(30);
      expect(hours, `${w.name} w0 Nov ≠ 24h (bug #146)`).not.toBe(24);
      expect(hours, `${w.name} w0 Nov = 42h`).toBe(42);
    }
  });
});

// ── Dezembro 2026 — 4 semanas ─────────────────────────────────────────────────
// w0: Dez 6–12 | globalWi=48 → '36h' | sem bug → ≥ 36h
describe('Fix #146 — Dez/2026 w0 (Dez 6–12, globalWi=48=36h, 4 semanas)', () => {
  it('todos os 4 workers Noturno recebem pelo menos 36h em w0', async () => {
    const workers = createNoturnoWorkers(1, 2026);
    await generateSchedule({ month: 12, year: 2026 });

    for (const w of workers) {
      const entries = getEntries(w.id);
      const hours = weekHours(entries, '2026-12-06', '2026-12-12');
      expect(hours, `${w.name} w0 Dez ≥ 36h`).toBeGreaterThanOrEqual(36);
    }
  });
});
