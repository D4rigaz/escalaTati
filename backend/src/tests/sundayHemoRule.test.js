/**
 * test: Regra de negócio — domingos sem Hemodiálise (issue #162)
 *
 * Desenvolvedor Pleno
 *
 * Valida que:
 *   - Funcionários exclusivamente Hemo têm is_day_off=TRUE em todos os domingos
 *   - Polivalentes (Hemo+Ambul) trabalham nos domingos (não recebem day_off)
 *   - Cobertura mínima nos domingos: ≥1 Ambulância no Diurno E ≥1 no Noturno
 *   - Elenco sem Ambulância emite warnings de cobertura nos domingos
 *
 * Cobertura obrigatória (CLAUDE.md): todos os 12 meses de 2026
 * Meses de alto risco (semana parcial ≥4 dias): Abr, Jun, Jul, Set, Dez
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';
import { getSchedulePeriod } from '../services/scheduleGenerator.js';

beforeEach(async () => { await freshDb(); });

const YEAR = 2026;
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const SHIFT_DIURNO_ID  = 1;
const SHIFT_NOTURNO_ID = 2;

const SETOR_HEMO  = 'Transporte Hemodiálise';
const SETOR_AMBUL = 'Transporte Ambulância';

function getPeriodDates(month, year) {
  const { startDate, endDate } = getSchedulePeriod(month, year);
  const dates = [];
  const cursor = new Date(startDate + 'T12:00:00Z');
  const end    = new Date(endDate   + 'T12:00:00Z');
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function getSundaysInPeriod(month, year) {
  return getPeriodDates(month, year).filter(
    (d) => new Date(d + 'T12:00:00Z').getUTCDay() === 0
  );
}

/** Retorna mapa empId → setores[] consultando a API de employees */
async function buildSetoresMap() {
  const res = await request(app).get('/api/employees');
  expect(res.status).toBe(200);
  const map = {};
  for (const emp of res.body) {
    map[emp.id] = emp.setores || [];
  }
  return map;
}

// ─── Elencos ──────────────────────────────────────────────────────────────────

/** Cria elenco realístico com pure-Hemo, pure-Ambul e polivalentes */
async function setupFullCrew() {
  for (let i = 1; i <= 4; i++) {
    await request(app).post('/api/employees').send({
      name: `Hemo ${i}`,
      setores: [SETOR_HEMO],
      cycle_start_month: ((i - 1) % 3) + 1,
      cycle_start_year: YEAR,
      work_schedule: 'dom_sab',
      restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
    }).expect(201);
  }
  for (let i = 1; i <= 4; i++) {
    await request(app).post('/api/employees').send({
      name: `Amb ${i}`,
      setores: [SETOR_AMBUL],
      cycle_start_month: ((i - 1) % 3) + 1,
      cycle_start_year: YEAR,
      work_schedule: 'dom_sab',
      restRules: { preferred_shift_id: SHIFT_NOTURNO_ID },
    }).expect(201);
  }
  await request(app).post('/api/employees').send({
    name: 'Polivalente Diurno',
    setores: [SETOR_HEMO, SETOR_AMBUL],
    cycle_start_month: 1,
    cycle_start_year: YEAR,
    work_schedule: 'dom_sab',
    restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
  }).expect(201);
  await request(app).post('/api/employees').send({
    name: 'Polivalente Noturno',
    setores: [SETOR_HEMO, SETOR_AMBUL],
    cycle_start_month: 2,
    cycle_start_year: YEAR,
    work_schedule: 'dom_sab',
    restRules: { preferred_shift_id: SHIFT_NOTURNO_ID },
  }).expect(201);
}

/** Cria elenco com apenas pure-Hemo (sem nenhuma Ambulância) — para teste de warning */
async function setupHemoOnlyCrew() {
  for (let i = 1; i <= 4; i++) {
    await request(app).post('/api/employees').send({
      name: `Hemo ${i}`,
      setores: [SETOR_HEMO],
      cycle_start_month: ((i - 1) % 3) + 1,
      cycle_start_year: YEAR,
      work_schedule: 'dom_sab',
      restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
    }).expect(201);
  }
}

/** Cria elenco com apenas polivalentes (sem pure-Hemo e sem pure-Ambul) */
async function setupPolivalenteCrew() {
  await request(app).post('/api/employees').send({
    name: 'Polivalente Diurno',
    setores: [SETOR_HEMO, SETOR_AMBUL],
    cycle_start_month: 1,
    cycle_start_year: YEAR,
    work_schedule: 'dom_sab',
    restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
  }).expect(201);
  await request(app).post('/api/employees').send({
    name: 'Polivalente Noturno',
    setores: [SETOR_HEMO, SETOR_AMBUL],
    cycle_start_month: 2,
    cycle_start_year: YEAR,
    work_schedule: 'dom_sab',
    restRules: { preferred_shift_id: SHIFT_NOTURNO_ID },
  }).expect(201);
}

// ─── Suite 1: pure-Hemo não trabalha nos domingos — 12 meses ─────────────────

describe('Regra #162 — pure-Hemo: is_day_off=TRUE em todos os domingos', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — nenhum Hemo-exclusivo trabalha no domingo`, async () => {
      await setupFullCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const setoresMap = await buildSetoresMap();

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      expect(res.status).toBe(200);
      const entries = res.body.entries;

      const sundays = getSundaysInPeriod(month, YEAR);
      for (const sunday of sundays) {
        const hemoExclusiveWorking = entries.filter(e => {
          if (e.date !== sunday) return false;
          if (e.is_day_off || !(e.duration_hours > 0)) return false;
          const setores = setoresMap[e.employee_id] || [];
          return setores.includes(SETOR_HEMO) && !setores.includes(SETOR_AMBUL);
        });
        expect(
          hemoExclusiveWorking.map(e => `${e.employee_name}@${sunday}`),
          `${sunday}: Hemo-exclusivos não devem trabalhar no domingo`
        ).toHaveLength(0);
      }
    });
  }
});

// ─── Suite 2: polivalentes trabalham nos domingos — 12 meses ─────────────────

describe('Regra #162 — polivalentes (Hemo+Ambul): trabalham nos domingos', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — ao menos 1 polivalente trabalha em cada domingo`, async () => {
      await setupPolivalenteCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const setoresMap = await buildSetoresMap();

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      expect(res.status).toBe(200);
      const entries = res.body.entries;

      const sundays = getSundaysInPeriod(month, YEAR);
      for (const sunday of sundays) {
        const polivalenteWorking = entries.filter(e => {
          if (e.date !== sunday) return false;
          if (e.is_day_off || !(e.duration_hours > 0)) return false;
          const setores = setoresMap[e.employee_id] || [];
          return setores.includes(SETOR_HEMO) && setores.includes(SETOR_AMBUL);
        });
        expect(
          polivalenteWorking.length,
          `${sunday}: ao menos 1 polivalente deve trabalhar no domingo`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

// ─── Suite 3: cobertura mínima ≥1 Ambulância Diurno E Noturno — 12 meses ─────

describe('Regra #162 — ≥1 Ambulância Diurno em cada domingo (12 meses)', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — ≥1 Ambulância Diurno em cada domingo`, async () => {
      await setupFullCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const setoresMap = await buildSetoresMap();

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      expect(res.status).toBe(200);
      const entries = res.body.entries;

      const sundays = getSundaysInPeriod(month, YEAR);
      for (const sunday of sundays) {
        const ambulDiurno = entries.filter(e => {
          if (e.date !== sunday) return false;
          if (e.is_day_off || !(e.duration_hours > 0)) return false;
          if (e.shift_name !== 'Diurno') return false;
          const setores = setoresMap[e.employee_id] || [];
          return setores.includes(SETOR_AMBUL);
        });
        expect(
          ambulDiurno.length,
          `${sunday}: deve ter ≥1 Ambulância no Diurno`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('Regra #162 — ≥1 Ambulância Noturno em cada domingo (12 meses)', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — ≥1 Ambulância Noturno em cada domingo`, async () => {
      await setupFullCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const setoresMap = await buildSetoresMap();

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      expect(res.status).toBe(200);
      const entries = res.body.entries;

      const sundays = getSundaysInPeriod(month, YEAR);
      for (const sunday of sundays) {
        const ambulNoturno = entries.filter(e => {
          if (e.date !== sunday) return false;
          if (e.is_day_off || !(e.duration_hours > 0)) return false;
          if (e.shift_name !== 'Noturno') return false;
          const setores = setoresMap[e.employee_id] || [];
          return setores.includes(SETOR_AMBUL);
        });
        expect(
          ambulNoturno.length,
          `${sunday}: deve ter ≥1 Ambulância no Noturno`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

// ─── Suite 4: elenco sem Ambulância → warnings nos domingos ──────────────────

describe('Regra #162 — warnings de cobertura quando não há Ambulância', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — elenco só Hemo emite warnings de cobertura nos domingos`, async () => {
      await setupHemoOnlyCrew();
      const gen = await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const sundays = getSundaysInPeriod(month, YEAR);
      const sundayWarnings = (gen.body.warnings ?? []).filter(
        w => sundays.includes(w.date) &&
             (w.type === 'diurno_ambul' || w.type === 'noturno_ambul')
      );
      expect(
        sundayWarnings.length,
        `${label}: deve haver warnings de cobertura nos domingos com elenco só-Hemo`
      ).toBeGreaterThan(0);
    });
  }
});
