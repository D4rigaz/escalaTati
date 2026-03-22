/**
 * test: validação de regras de negócio — todos os meses de 2026
 *
 * Tester Senior
 *
 * Para cada mês de 2026, gera a escala com um elenco realístico mínimo
 * e valida as regras de negócio fundamentais:
 *
 * Regras verificadas:
 *   - Período correto: inicia no 1º domingo do mês, termina no sábado anterior
 *     ao 1º domingo do mês seguinte (4 ou 5 semanas completas)
 *   - Geração bem-sucedida: success=true, sem warnings críticos (sem_motorista),
 *     sem crew_warnings (elenco mínimo atendido)
 *   - Regra 19/42: cobertura diária ≥ MIN_DAILY_COVERAGE (2) em todos os dias
 *   - Regra 4: descanso ≥ 12h entre turnos consecutivos por motorista
 *     (threshold ≥12h para acomodar pares emendados intra-dia; o gerador
 *     garante os 24h pós-bloco emendado)
 *   - Regra #30: máx 6 dias de trabalho consecutivos por motorista
 *   - Regra 12: workers seg_sex não trabalham aos Sábados ou Domingos
 *   - Durações válidas: apenas 6h, 10h ou 12h por turno trabalhado
 *
 * Elenco usado (atende crew mínimo recomendado — sem crew_warnings):
 *   - 4 × Transporte Hemodiálise  (dom_sab, preferred Diurno)
 *   - 4 × Transporte Ambulância   (dom_sab, preferred Noturno)
 *   - 2 × Transporte Administrativo (seg_sex)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';
import { getSchedulePeriod } from '../services/scheduleGenerator.js';

beforeEach(() => freshDb());

const YEAR = 2026;
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Meses de 2026 que produzem 5 semanas (35 dias): Mar, Mai, Ago, Nov
const FIVE_WEEK_MONTHS = new Set([3, 5, 8, 11]);

const SHIFT_DIURNO_ID  = 1;
const SHIFT_NOTURNO_ID = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupCrew() {
  for (let i = 1; i <= 4; i++) {
    await request(app).post('/api/employees').send({
      name: `Hemo ${i}`,
      setores: ['Transporte Hemodiálise'],
      cycle_start_month: 1,
      cycle_start_year: YEAR,
      work_schedule: 'dom_sab',
      restRules: { preferred_shift_id: SHIFT_DIURNO_ID },
    }).expect(201);
  }
  for (let i = 1; i <= 4; i++) {
    await request(app).post('/api/employees').send({
      name: `Amb ${i}`,
      setores: ['Transporte Ambulância'],
      cycle_start_month: 1,
      cycle_start_year: YEAR,
      work_schedule: 'dom_sab',
      restRules: { preferred_shift_id: SHIFT_NOTURNO_ID },
    }).expect(201);
  }
  for (let i = 1; i <= 2; i++) {
    await request(app).post('/api/employees').send({
      name: `Adm ${i}`,
      setores: ['Transporte Administrativo'],
      cycle_start_month: 1,
      cycle_start_year: YEAR,
      work_schedule: 'seg_sex',
    }).expect(201);
  }
}

function getPeriodDates(month, year) {
  const { startDate, endDate } = getSchedulePeriod(month, year);
  const dates = [];
  const cursor = new Date(startDate + 'T12:00:00Z');
  const end    = new Date(endDate   + 'T12:00:00Z');
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { dates, startDate, endDate };
}

function shiftStartMs(e) {
  const [h, m] = e.start_time.split(':').map(Number);
  return new Date(`${e.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).getTime();
}

function shiftEndMs(e) {
  return shiftStartMs(e) + e.duration_hours * 3_600_000;
}

// ─── Suite 1: estrutura do período (pura computação, sem DB) ─────────────────

describe('estrutura do período mensal 2026', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;
    const expectedWeeks = FIVE_WEEK_MONTHS.has(month) ? 5 : 4;

    it(`${label} — começa Dom, termina Sáb, ${expectedWeeks} semanas (${expectedWeeks * 7} dias)`, () => {
      const { dates } = getPeriodDates(month, YEAR);

      expect(dates.length % 7, 'período não é múltiplo de 7 dias').toBe(0);
      expect(dates.length / 7, `esperado ${expectedWeeks} semanas`).toBe(expectedWeeks);

      const dowFirst = new Date(dates[0] + 'T12:00:00Z').getUTCDay();
      const dowLast  = new Date(dates[dates.length - 1] + 'T12:00:00Z').getUTCDay();
      expect(dowFirst, `${label}: primeiro dia deve ser Domingo (0), foi ${dowFirst}`).toBe(0);
      expect(dowLast,  `${label}: último dia deve ser Sábado (6), foi ${dowLast}`).toBe(6);
    });
  }
});

// ─── Suite 2: regras de negócio por mês ──────────────────────────────────────

describe('regras de negócio — geração para todos os meses de 2026', () => {
  for (const month of ALL_MONTHS) {
    const label = `${String(month).padStart(2, '0')}/${YEAR}`;

    it(`${label} — geração bem-sucedida, sem warnings críticos, sem crew_warnings`, async () => {
      await setupCrew();
      const gen = await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true });

      expect(gen.status).toBe(200);
      expect(gen.body.success, 'success deve ser true').toBe(true);

      // Sem warnings de impossibilidade de cobertura
      const critical = (gen.body.warnings ?? []).filter(w => w.type === 'sem_motorista');
      expect(critical, `warnings críticos: ${JSON.stringify(critical)}`).toHaveLength(0);

      // Elenco atende mínimo recomendado — sem crew_warnings
      expect(gen.body.crew_warnings, 'crew_warnings deve estar vazio').toHaveLength(0);
    });

    it(`${label} — Regra 19/42: cobertura diária ≥2 em todos os dias`, async () => {
      await setupCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      expect(res.status).toBe(200);
      const entries = res.body.entries;

      const { dates } = getPeriodDates(month, YEAR);
      for (const date of dates) {
        const working = entries.filter(e =>
          e.date === date && !e.is_day_off && (e.duration_hours ?? 0) > 0
        );
        const unique = new Set(working.map(e => e.employee_id));
        expect(unique.size, `${date}: ${unique.size} worker(s) presentes (mínimo 2)`).toBeGreaterThanOrEqual(2);
      }
    });

    it(`${label} — Regra 4: descanso ≥24h entre turnos consecutivos (exceto pares emendados)`, async () => {
      await setupCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      const entries = res.body.entries;

      // Pares emendados permitidos: back-to-back sem descanso intermediário
      // (Noturno 19:00-07:00 → Manhã 07:00 | Manhã 07:00-13:00 → Tarde 13:00 | Tarde 13:00-19:00 → Noturno 19:00)
      const EMENDADO = new Set(['Noturno→Manhã', 'Manhã→Tarde', 'Tarde→Noturno']);

      const byEmp = {};
      for (const e of entries) {
        if (e.is_day_off || !e.start_time || !(e.duration_hours > 0)) continue;
        (byEmp[e.employee_id] ??= []).push(e);
      }

      for (const [empId, shifts] of Object.entries(byEmp)) {
        const sorted = shifts.sort((a, b) =>
          a.date.localeCompare(b.date) || shiftStartMs(a) - shiftStartMs(b)
        );
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const restMs  = shiftStartMs(curr) - shiftEndMs(prev);
          const pairKey = `${prev.shift_name}→${curr.shift_name}`;

          // Par emendado com encaixe imediato (restMs ≤ 0): permitido por regra de negócio
          if (EMENDADO.has(pairKey) && restMs <= 0) continue;

          const restH = restMs / 3_600_000;
          expect(
            restH,
            `Emp ${empId}: descanso entre ${prev.date} ${prev.start_time} (${prev.shift_name}) ` +
            `e ${curr.date} ${curr.start_time} (${curr.shift_name}) = ${restH.toFixed(1)}h (mínimo 24h)`
          ).toBeGreaterThanOrEqual(24);
        }
      }
    });

    it(`${label} — Regra #30: máx 6 dias de trabalho consecutivos por motorista`, async () => {
      await setupCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      const entries = res.body.entries;

      const { dates } = getPeriodDates(month, YEAR);
      const empIds = [...new Set(entries.map(e => e.employee_id))];

      for (const empId of empIds) {
        let consecutive = 0;
        for (const date of dates) {
          const working = entries.some(
            e => e.employee_id === empId && e.date === date && !e.is_day_off && (e.duration_hours ?? 0) > 0
          );
          if (working) {
            consecutive++;
            expect(
              consecutive,
              `Emp ${empId} em ${date}: ${consecutive} dias consecutivos (máx 6)`
            ).toBeLessThanOrEqual(6);
          } else {
            consecutive = 0;
          }
        }
      }
    });

    it(`${label} — Regra 12: workers seg_sex não trabalham Sáb/Dom`, async () => {
      await setupCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      const entries = res.body.entries;

      const violations = entries.filter(e =>
        e.employee_work_schedule === 'seg_sex' &&
        !e.is_day_off &&
        (e.duration_hours ?? 0) > 0 &&
        [0, 6].includes(new Date(e.date + 'T12:00:00Z').getUTCDay())
      );
      expect(
        violations.map(e => `${e.employee_id}@${e.date}`),
        'workers seg_sex não devem trabalhar Sáb/Dom'
      ).toHaveLength(0);
    });

    it(`${label} — durações de turno válidas: apenas 6h, 10h ou 12h`, async () => {
      await setupCrew();
      await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: YEAR, overwriteLocked: true })
        .expect(200);

      const res = await request(app).get(`/api/schedules?month=${month}&year=${YEAR}`);
      const workEntries = res.body.entries.filter(e =>
        !e.is_day_off && (e.duration_hours ?? 0) > 0
      );

      for (const e of workEntries) {
        expect(
          [6, 10, 12],
          `Emp ${e.employee_id} em ${e.date}: duração inválida ${e.duration_hours}h`
        ).toContain(e.duration_hours);
      }
    });
  }
});
