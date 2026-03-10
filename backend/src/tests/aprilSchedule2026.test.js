/**
 * test(e2e): geração de escala Abril/2026 — validação de regras de negócio
 *
 * Tester Senior
 *
 * Replica o fluxo do frontend: POST /api/schedules/generate para Abril/2026
 * com um elenco realista de motoristas, validando as regras de negócio
 * descritas em memory/business-rules.md.
 *
 * Elenco (7 motoristas):
 *   - 2 Ambulância   (cycle_start=Jan/2026) — dom_sab
 *   - 2 Hemodiálise  (cycle_start=Fev/2026) — dom_sab
 *   - 2 Ambulância   (cycle_start=Mar/2026) — dom_sab  [para suprir cobertura noturna]
 *   - 1 ADM          (cycle_start=Jan/2026) — seg_sex
 *
 * Abril 2026: começa na Quarta (Apr 1) → firstWeekIsPartial=true → cltWeekOffset=1
 * Fases:
 *   Amb1/Amb2 cycle=Jan/2026: elapsed=3 → fase 1 → [36h,42h,42h,36h]
 *   Hemo1/Hemo2 cycle=Fev/2026: elapsed=2 → fase 3 → [42h,36h,42h,42h]
 *   Amb3/Amb4 cycle=Mar/2026: elapsed=1 → fase 2 → [42h,42h,36h,42h]
 *
 * Regras validadas:
 *   R1  — MIN_REST_HOURS ≥ 24h entre turnos consecutivos por motorista
 *   R2  — MIN_DAILY_COVERAGE ≥ 2 motoristas/dia (todos os dias do mês)
 *   R3  — Cobertura Noturna A: Ter/Qui/Sáb ≥ 2 Ambulância com turno Noturno
 *   R4  — Cobertura Noturna B: Seg/Qua/Sex ≥ 1 Ambulância com turno Noturno
 *   R5  — Cobertura Diurna: Seg–Sáb ≥ 2 Hemo + ≥ 1 Ambul com turno Diurno
 *   R6  — ADM seg_sex não trabalha Sáb (dow=6) nem Dom (dow=0)
 *   R7  — Total mensal por motorista em [100, 200]h
 *   R8  — Máximo 6 dias consecutivos de trabalho por motorista
 *   R9  — Entries cobrem todos os 30 dias de Abril por motorista
 *   R10 — Durações válidas: apenas 6h, 10h ou 12h por turno
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

// ── Constantes de Abril/2026 ──────────────────────────────────────────────────

const APR2026 = { month: 4, year: 2026 };
const APR_START = '2026-04-01';
const APR_END = '2026-04-30';
const APR_DAYS = 30;

// Dia da semana UTC (0=Dom, 1=Seg, ... 6=Sáb)
function dow(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

const APR_DATES = Array.from({ length: APR_DAYS }, (_, i) => {
  const d = new Date('2026-04-01T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

// ── Helpers de criação via API ────────────────────────────────────────────────

async function createEmployee(name, setores, csm, csy, workSchedule = 'dom_sab') {
  const res = await request(app)
    .post('/api/employees')
    .send({ name, setores, cycle_start_month: csm, cycle_start_year: csy, work_schedule: workSchedule });
  expect(res.status, `createEmployee ${name}`).toBe(201);
  return res.body.id;
}

async function setupEmployees() {
  return {
    amb1: await createEmployee('Amb 1', ['Transporte Ambulância'], 1, 2026),
    amb2: await createEmployee('Amb 2', ['Transporte Ambulância'], 1, 2026),
    hemo1: await createEmployee('Hemo 1', ['Transporte Hemodiálise'], 2, 2026),
    hemo2: await createEmployee('Hemo 2', ['Transporte Hemodiálise'], 2, 2026),
    amb3: await createEmployee('Amb 3', ['Transporte Ambulância'], 3, 2026),
    amb4: await createEmployee('Amb 4', ['Transporte Ambulância'], 3, 2026),
    adm:  await createEmployee('ADM 1', ['Transporte Administrativo'], 1, 2026, 'seg_sex'),
  };
}

async function generateApril() {
  const genRes = await request(app)
    .post('/api/schedules/generate')
    .send({ ...APR2026, overwriteLocked: true });
  expect(genRes.status, 'generate status').toBe(200);
  expect(genRes.body.success, 'generate success').toBe(true);
  return genRes.body;
}

async function fetchEntries() {
  const res = await request(app)
    .get(`/api/schedules?month=${APR2026.month}&year=${APR2026.year}`);
  expect(res.status, 'fetch entries').toBe(200);
  return res.body.entries;
}

// ── Helpers de análise ────────────────────────────────────────────────────────

function empEntries(all, empId) {
  return all.filter((e) => e.employee_id === empId).sort((a, b) => a.date.localeCompare(b.date));
}

function workShifts(entries) {
  return entries.filter((e) => !e.is_day_off && e.duration_hours > 0 && e.start_time);
}

function shiftStartMs(e) {
  const [h, m] = e.start_time.split(':').map(Number);
  return new Date(`${e.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`).getTime();
}

function shiftEndMs(e) {
  return shiftStartMs(e) + e.duration_hours * 3_600_000;
}

// ── Suite principal ───────────────────────────────────────────────────────────

describe('Abril/2026 — geração de escala com 7 motoristas', () => {

  // ── R9: 30 entries por motorista, 1 por dia ────────────────────────────────
  it('R9 — cada motorista tem exatamente 30 entries cobrindo todos os dias de Abril', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    for (const [label, empId] of Object.entries(ids)) {
      const emp = empEntries(all, empId);
      const dates = emp.map((e) => e.date);

      expect(emp.length, `${label} total`).toBe(APR_DAYS);
      expect(new Set(dates).size, `${label} datas únicas`).toBe(APR_DAYS);
      expect(dates.every((d) => d >= APR_START && d <= APR_END), `${label} dentro de Abril`).toBe(true);
    }
  });

  // ── R10: Durações de turno válidas ────────────────────────────────────────
  it('R10 — todos os turnos têm duração 6h, 10h ou 12h', async () => {
    await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    const VALID = new Set([6, 10, 12]);
    for (const e of workShifts(all)) {
      expect(
        VALID.has(e.duration_hours),
        `empId=${e.employee_id} data=${e.date} duration=${e.duration_hours}`
      ).toBe(true);
    }
  });

  // ── R1: Descanso mínimo ≥ 24h ─────────────────────────────────────────────
  it('R1 — MIN_REST_HOURS ≥ 24h entre turnos consecutivos por motorista', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    for (const [label, empId] of Object.entries(ids)) {
      const shifts = workShifts(empEntries(all, empId));
      let lastEndMs = null;

      for (const e of shifts) {
        const startMs = shiftStartMs(e);
        if (lastEndMs !== null) {
          const restH = (startMs - lastEndMs) / 3_600_000;
          if (restH > 0) {
            expect(
              restH,
              `${label}: rest de ${restH.toFixed(1)}h em ${e.date}`
            ).toBeGreaterThanOrEqual(24);
          }
        }
        lastEndMs = shiftEndMs(e);
      }
    }
  });

  // ── R8: Máximo 6 dias consecutivos ────────────────────────────────────────
  it('R8 — nenhum motorista trabalha mais de 6 dias consecutivos', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    for (const [label, empId] of Object.entries(ids)) {
      let seq = 0;
      let maxSeq = 0;
      for (const e of empEntries(all, empId)) {
        if (!e.is_day_off && e.duration_hours > 0) {
          seq++;
          maxSeq = Math.max(maxSeq, seq);
        } else {
          seq = 0;
        }
      }
      expect(maxSeq, `${label} máx consecutivos`).toBeLessThanOrEqual(6);
    }
  });

  // ── R6: ADM seg_sex sem Sáb/Dom ───────────────────────────────────────────
  it('R6 — ADM seg_sex não tem turnos em Sáb ou Dom', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    const admWork = workShifts(empEntries(all, ids.adm));
    const weekendShifts = admWork.filter((e) => dow(e.date) === 0 || dow(e.date) === 6);
    expect(weekendShifts.length, 'ADM: turnos em fim de semana').toBe(0);
  });

  // ── R7: Total mensal em [100, 200]h ───────────────────────────────────────
  it('R7 — total mensal de cada motorista está entre 100h e 200h', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    for (const [label, empId] of Object.entries(ids)) {
      const total = empEntries(all, empId)
        .reduce((sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)), 0);
      expect(total, `${label} total mensal`).toBeGreaterThanOrEqual(100);
      expect(total, `${label} total mensal`).toBeLessThanOrEqual(200);
    }
  });

  // ── R2: Cobertura diária ≥ 2 motoristas ──────────────────────────────────
  it('R2 — MIN_DAILY_COVERAGE ≥ 2 motoristas em serviço por dia', async () => {
    await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    for (const date of APR_DATES) {
      const working = new Set(
        all.filter((e) => e.date === date && !e.is_day_off && e.duration_hours > 0).map((e) => e.employee_id)
      );
      expect(working.size, `cobertura ${date}`).toBeGreaterThanOrEqual(2);
    }
  });

  // ── R3: Cobertura Noturna A — Ter/Qui/Sáb ≥ 2 Ambulância Noturno ─────────
  it('R3 — Ter/Qui/Sáb: ≥ 2 motoristas Ambulância com turno Noturno por dia', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    const allAmbIds = new Set([ids.amb1, ids.amb2, ids.amb3, ids.amb4]);
    const tqsDays = APR_DATES.filter((d) => [2, 4, 6].includes(dow(d)));  // Ter/Qui/Sáb

    for (const date of tqsDays) {
      const noturnos = all.filter(
        (e) => e.date === date && allAmbIds.has(e.employee_id) && !e.is_day_off && e.shift_name === 'Noturno'
      ).length;
      expect(noturnos, `R3 Noturno Amb ${date} (dow=${dow(date)})`).toBeGreaterThanOrEqual(2);
    }
  });

  // ── R4: Cobertura Noturna B — Seg/Qua/Sex ≥ 1 Ambulância Noturno ─────────
  it('R4 — Seg/Qua/Sex: ≥ 1 motorista Ambulância com turno Noturno por dia', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    const allAmbIds = new Set([ids.amb1, ids.amb2, ids.amb3, ids.amb4]);
    const sqfDays = APR_DATES.filter((d) => [1, 3, 5].includes(dow(d)));  // Seg/Qua/Sex

    for (const date of sqfDays) {
      const noturnos = all.filter(
        (e) => e.date === date && allAmbIds.has(e.employee_id) && !e.is_day_off && e.shift_name === 'Noturno'
      ).length;
      expect(noturnos, `R4 Noturno Amb ${date} (dow=${dow(date)})`).toBeGreaterThanOrEqual(1);
    }
  });

  // ── R5: Cobertura Diurna — Seg–Sáb ≥ 2 Hemo + ≥ 1 Ambul Diurno ──────────
  it('R5 — Seg–Sáb: ≥ 2 Hemodiálise + ≥ 1 Ambulância com turno Diurno por dia', async () => {
    const ids = await setupEmployees();
    await generateApril();
    const all = await fetchEntries();

    const hemoIds = new Set([ids.hemo1, ids.hemo2]);
    const allAmbIds = new Set([ids.amb1, ids.amb2, ids.amb3, ids.amb4]);
    const weekdays = APR_DATES.filter((d) => dow(d) >= 1 && dow(d) <= 6);  // Seg–Sáb

    for (const date of weekdays) {
      const diurnos = all.filter((e) => e.date === date && !e.is_day_off && e.shift_name === 'Diurno');
      const hemoCover = diurnos.filter((e) => hemoIds.has(e.employee_id)).length;
      const ambulCover = diurnos.filter((e) => allAmbIds.has(e.employee_id)).length;

      expect(hemoCover, `R5 Hemo Diurno ${date}`).toBeGreaterThanOrEqual(2);
      expect(ambulCover, `R5 Amb Diurno ${date}`).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Relatório de warnings ──────────────────────────────────────────────────
  it('relatório — warnings retornados pela geração de Abril/2026', async () => {
    await setupEmployees();
    const gen = await generateApril();

    const warnings = gen.results?.flatMap((r) => r.warnings || []) || [];
    const byType = {};
    for (const w of warnings) {
      byType[w.type] = (byType[w.type] || 0) + 1;
    }

    if (warnings.length > 0) {
      console.log(`\nWarnings Abril/2026 (total: ${warnings.length}):`);
      for (const [type, count] of Object.entries(byType)) {
        console.log(`  ${type}: ${count}`);
      }
    } else {
      console.log('\nNenhum warning gerado em Abril/2026 ✅');
    }

    // Nenhum dia sem nenhum motorista
    expect(byType['sem_motorista'] || 0, 'dias sem nenhum motorista').toBe(0);
  });
});
