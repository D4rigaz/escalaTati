/**
 * test(generator): turno noturno em semana de 42h — issue #65
 *
 * Tester Senior (coberto pelo Desenvolvedor Pleno como parte do #65)
 *
 * Critérios de aceite:
 *   - Motorista NOTURNO em semana 36h: apenas turnos de 12h (sem extra 6h)
 *   - Motorista NOTURNO em semana 42h: 3 × 12h + 1 × 6h (Manhã ou Tarde)
 *   - O turno extra de 6h respeita descanso mínimo de 24h (ou emendado válido) com o Noturno adjacente
 *   - Motorista DIURNO em semana 42h: sem turno extra de 6h (regra exclusiva do NOTURNO)
 *
 * Calendário de referência — Fevereiro 2025 (28 dias):
 *   Feb 1 = Sábado → Semana 0: [Feb 1]
 *   Feb 2 = Domingo → Semana 1: [Feb 2–8]   (42h com cycle_start=Fev/2025)
 *   Feb 9 = Domingo → Semana 2: [Feb 9–15]  (42h com cycle_start=Fev/2025)
 *   Feb 16 = Domingo → Semana 3: [Feb 16–22] (36h com cycle_start=Fev/2025)
 *   Feb 23 = Domingo → Semana 4: [Feb 23–28] (36h com cycle_start=Fev/2025)
 *
 * calculateEffectiveCycleMonth(2, 2025, 2, 2025) → elapsed=0 → phase=1
 * getWeekTypeFromPhase(1, wi) → patterns[1] = ['36h','42h','42h','36h']
 *   wi=0 → 36h, wi=1 → 42h, wi=2 → 42h, wi=3 → 36h, wi=4 → 36h (clamped)
 * (idêntico ao antigo getWeekType(3, 2, wi) → actualCycle=0 → patterns[0])
 *
 * Total esperado com cycle_start=Fev/2025 em Feb/2025 (motorista NOTURNO):
 *   Semana 0 (1 dia): 0 plantões (1 dia livre → min 1 folga → 0 trabalho)
 *   Semanas 1 e 2 (42h): 3 × 12h + 1 × 6h = 42h cada
 *   Semanas 3 e 4 (36h): 3 × 12h = 36h cada
 *   Total = 0 + 42 + 42 + 36 + 36 = 156h → desvio = -4h (≤ ±6h → correctHours não altera)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

const FEV = { month: 2, year: 2025 };

// Semanas de Fevereiro 2025 (baseadas em Domingo)
const FEV_WEEK1 = ['2025-02-02','2025-02-03','2025-02-04','2025-02-05','2025-02-06','2025-02-07','2025-02-08'];
const FEV_WEEK2 = ['2025-02-09','2025-02-10','2025-02-11','2025-02-12','2025-02-13','2025-02-14','2025-02-15'];
const FEV_WEEK3 = ['2025-02-16','2025-02-17','2025-02-18','2025-02-19','2025-02-20','2025-02-21','2025-02-22'];
const FEV_WEEK4 = ['2025-02-23','2025-02-24','2025-02-25','2025-02-26','2025-02-27','2025-02-28'];

beforeEach(() => freshDb());

// ── Helpers ───────────────────────────────────────────────────────────────────

function entriesInWeek(allEntries, empId, weekDates) {
  return allEntries.filter((e) => e.employee_id === empId && weekDates.includes(e.date));
}

function workEntriesInWeek(allEntries, empId, weekDates) {
  return entriesInWeek(allEntries, empId, weekDates).filter((e) => !e.is_day_off);
}

/**
 * Cria motorista via API com preferred_shift por nome.
 * cycle_start padrão: Fev/2025 → elapsed=0 → phase=1 para Fev/2025
 * (equivale ao antigo cycle_month=3 para genMonth=2: actualCycle=0 → patterns[0]=['36h','42h','42h','36h'])
 * getWeekTypeFromPhase(1,wi) = patterns[1]=['36h','42h','42h','36h'] — padrão idêntico.
 */
async function createNoturnoEmployee(name, cycleStartMonth = 2, cycleStartYear = 2025) {
  // Busca o id do turno Noturno a partir da lista de shift-types
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
  return { emp: empRes.body, noturnoId };
}

async function createDiurnoEmployee(name, cycleStartMonth = 2, cycleStartYear = 2025) {
  const shiftsRes = await request(app).get('/api/shift-types');
  const diurnoId = shiftsRes.body.find((s) => s.name === 'Diurno')?.id;
  expect(diurnoId).toBeDefined();

  const empRes = await request(app).post('/api/employees').send({
    name,
    setores: ['Transporte Ambulância'],
    cycle_start_month: cycleStartMonth,
    cycle_start_year: cycleStartYear,
    restRules: { preferred_shift_id: diurnoId, notes: null },
  });
  expect(empRes.status).toBe(201);
  return { emp: empRes.body, diurnoId };
}

// ── Teste 1: Semana 36h — sem turno extra de 6h ───────────────────────────────

describe('Regra #65 — semana 36h: NOTURNO sem turno extra', () => {
  it('motorista NOTURNO em semana 36h (FEV_WEEK3 e FEV_WEEK4) não recebe turno extra de 6h', async () => {
    const { emp } = await createNoturnoEmployee('Noturno 36h');

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const allEntries = schedRes.body.entries;

    // Semanas 36h: nenhum turno de 6h
    const week3Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK3);
    const week4Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK4);

    const sixHourIn36 = [...week3Work, ...week4Work].filter((e) => e.duration_hours === 6);
    expect(sixHourIn36).toHaveLength(0);

    // Todos os turnos de trabalho nas semanas 36h são de 12h (NOTURNO)
    const allWork36 = [...week3Work, ...week4Work];
    allWork36.forEach((e) => {
      expect(e.duration_hours).toBe(12);
    });
  });
});

// ── Teste 2: Semana 42h — 1 turno extra de 6h ────────────────────────────────

describe('Regra #65 — semana 42h: NOTURNO com 1 turno extra de 6h', () => {
  it('motorista NOTURNO em semana 42h (FEV_WEEK1) tem exatamente 1 turno de 6h (Manhã ou Tarde)', async () => {
    const { emp } = await createNoturnoEmployee('Noturno 42h');

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const allEntries = schedRes.body.entries;

    const week1Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK1);
    const sixHourEntries = week1Work.filter((e) => e.duration_hours === 6);

    // Exatamente 1 turno de 6h na semana 42h
    expect(sixHourEntries).toHaveLength(1);

    // O turno extra é Manhã ou Tarde
    const validNames = ['Manhã', 'Tarde'];
    expect(validNames).toContain(sixHourEntries[0].shift_name);
  });

  it('motorista NOTURNO em semana 42h (FEV_WEEK2) tem exatamente 1 turno de 6h (Manhã ou Tarde)', async () => {
    const { emp } = await createNoturnoEmployee('Noturno 42h W2');

    await request(app).post('/api/schedules/generate').send(FEV);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const allEntries = schedRes.body.entries;

    const week2Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK2);
    const sixHourEntries = week2Work.filter((e) => e.duration_hours === 6);

    expect(sixHourEntries).toHaveLength(1);
    expect(['Manhã', 'Tarde']).toContain(sixHourEntries[0].shift_name);
  });
});

// ── Teste 3: Turno extra respeita descanso mínimo ────────────────────────────

describe('Regra #65 — turno extra de 6h respeita descanso mínimo de 24h (ou emendado válido)', () => {
  it('o turno extra de 6h na semana 42h tem ≥24h de descanso ou é emendado Noturno→Manhã válido', async () => {
    const { emp } = await createNoturnoEmployee('Noturno Rest Check');

    await request(app).post('/api/schedules/generate').send(FEV);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const allEntries = schedRes.body.entries;
    const empWork = allEntries
      .filter((e) => e.employee_id === emp.id && !e.is_day_off)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Encontra o turno extra de 6h em FEV_WEEK1
    const extraEntry = allEntries.find(
      (e) => e.employee_id === emp.id && FEV_WEEK1.includes(e.date) && e.duration_hours === 6
    );
    expect(extraEntry).toBeDefined();

    // Encontra o turno imediatamente anterior ao extra
    const extraDate = extraEntry.date;
    const prevWork = empWork.filter((e) => e.date < extraDate).at(-1);

    if (prevWork) {
      // Calcula rest entre fim do turno anterior e início do extra
      const prevEnd = new Date(`${prevWork.date}T${prevWork.start_time}:00`).getTime()
        + prevWork.duration_hours * 3_600_000;
      const extraStart = new Date(`${extraDate}T${extraEntry.start_time}:00`).getTime();
      const restHours = (extraStart - prevEnd) / 3_600_000;

      // Emendado válido: Noturno→Manhã (0h rest, 18h total ≤ 18h) OU descanso ≥ 24h
      const isEmendadoNoturnoManha =
        restHours === 0 &&
        prevWork.shift_name === 'Noturno' &&
        extraEntry.shift_name === 'Manhã' &&
        prevWork.duration_hours + extraEntry.duration_hours <= 18;

      expect(isEmendadoNoturnoManha || restHours >= 24).toBe(true);
    }
    // Se não há turno anterior (extra é o primeiro), sem restrição
  });
});

// ── Teste 4: Motorista DIURNO não recebe extra na semana 42h ─────────────────

describe('Regra #65 — motorista DIURNO não recebe turno extra de 6h', () => {
  it('motorista DIURNO em semana 42h não tem turno de 6h (regra exclusiva do NOTURNO)', async () => {
    const { emp } = await createDiurnoEmployee('Diurno 42h');

    await request(app).post('/api/schedules/generate').send(FEV);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const allEntries = schedRes.body.entries;

    // Semanas 42h para o DIURNO: sem turno de 6h
    const week1Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK1);
    const week2Work = workEntriesInWeek(allEntries, emp.id, FEV_WEEK2);

    const sixHourIn42 = [...week1Work, ...week2Work].filter((e) => e.duration_hours === 6);
    expect(sixHourIn42).toHaveLength(0);
  });
});
