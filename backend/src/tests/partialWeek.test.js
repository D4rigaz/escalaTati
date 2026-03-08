/**
 * test(generator): semanas parciais no início/fim do mês — issue #96
 *
 * Desenvolvedor Pleno
 *
 * Criterios de aceite (issue #96):
 *   - Semana parcial inicial (< 7 dias) NAO recebe meta CLT
 *   - O indice CLT (wi) comeca em 0 a partir da PRIMEIRA semana completa (7 dias).
 *   - Semanas completas subsequentes recebem o padrao CLT correto conforme a fase.
 *   - Geracao nao trava nem gera erro mesmo em casos extremos (Fev 2025: Sem 1 = 1 dia).
 *
 * Calendario de referencia — Abril/2026 (comeca Quarta = parcial):
 *   Sem 0 (parcial): [01-04/04] = 4 dias
 *   Sem 1 (Dom 05): [05-11/04] = 7 dias  cltWi=0
 *   Sem 2 (Dom 12): [12-18/04] = 7 dias  cltWi=1
 *   Sem 3 (Dom 19): [19-25/04] = 7 dias  cltWi=2
 *   Sem 4 (Dom 26): [26-30/04] = 5 dias  cltWi=3 (parcial final)
 *
 * Fase CLT — cycle_start=Fev/2025 em Abr/2026:
 *   elapsed=(2026*12+4)-(2025*12+2)=14 -> phase=((14%3)+3)%3+1=3
 *   getWeekTypeFromPhase(3, wi): 0->42h, 1->36h, 2->42h, 3->42h
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

const ABR_2026 = { month: 4, year: 2026 };
const FEV_2025 = { month: 2, year: 2025 };

const ABR_WEEK1_FULL = ['2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-11'];
const ABR_WEEK2_FULL = ['2026-04-12','2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17','2026-04-18'];
const ABR_WEEK3_FULL = ['2026-04-19','2026-04-20','2026-04-21','2026-04-22','2026-04-23','2026-04-24','2026-04-25'];

function workEntriesIn(entries, empId, dates) {
  return entries.filter(
    (e) => e.employee_id === empId && dates.includes(e.date) && !e.is_day_off
  );
}

function totalHoursOf(entries, empId) {
  return entries
    .filter((e) => e.employee_id === empId && !e.is_day_off)
    .reduce((sum, e) => sum + (e.duration_hours || 0), 0);
}

function weeklyHoursOf(entries, empId, dates) {
  return entries
    .filter((e) => e.employee_id === empId && dates.includes(e.date) && !e.is_day_off)
    .reduce((sum, e) => sum + (e.duration_hours || 0), 0);
}

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

async function createDiurnoEmployee(name, cycleStartMonth, cycleStartYear) {
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
  return empRes.body;
}

beforeEach(() => freshDb());

describe('Teste 1 — NOTURNO em Abril/2026 (semana parcial inicial de 4 dias)', () => {
  it('semana completa cltWi=0 (05-11/Abr) recebe 42h NOTURNO (3x12h + 1x6h)', async () => {
    const emp = await createNoturnoEmployee('Noturno Abr', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send(ABR_2026);
    expect(genRes.status).toBe(200);
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    expect(schedRes.status).toBe(200);
    const entries = schedRes.body.entries;
    const week1Hours = weeklyHoursOf(entries, emp.id, ABR_WEEK1_FULL);
    const week2Hours = weeklyHoursOf(entries, emp.id, ABR_WEEK2_FULL);
    const week3Hours = weeklyHoursOf(entries, emp.id, ABR_WEEK3_FULL);
    expect(week1Hours).toBe(42);
    expect(week2Hours).toBe(36);
    expect(week3Hours).toBe(42);
  });

  it('total mensal >= 100h (sanity check)', async () => {
    const emp = await createNoturnoEmployee('Noturno Abr Sanity', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send(ABR_2026);
    expect(genRes.status).toBe(200);
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    const totalHours = totalHoursOf(schedRes.body.entries, emp.id);
    expect(totalHours).toBeGreaterThanOrEqual(100);
  });

  it('DIURNO em Abril/2026: cltWi=1 (12-18/Abr) recebe 36h sem turno 6h', async () => {
    const emp = await createDiurnoEmployee('Diurno Abr', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send(ABR_2026);
    expect(genRes.status).toBe(200);
    const schedRes = await request(app).get('/api/schedules?month=4&year=2026');
    const entries = schedRes.body.entries;
    const week2Hours = weeklyHoursOf(entries, emp.id, ABR_WEEK2_FULL);
    expect(week2Hours).toBe(36);
    const week2Entries = workEntriesIn(entries, emp.id, ABR_WEEK2_FULL);
    const hasSixHour = week2Entries.some((e) => e.duration_hours === 6);
    expect(hasSixHour).toBe(false);
  });
});

describe('Teste 2 — Fevereiro/2025 (semana parcial extrema de 1 dia)', () => {
  it('geração nao trava nem gera erro — status 200 para NOTURNO', async () => {
    await createNoturnoEmployee('Noturno Fev', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send(FEV_2025);
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);
  });

  it('geração nao trava nem gera erro — status 200 para DIURNO', async () => {
    await createDiurnoEmployee('Diurno Fev', 2, 2025);
    const genRes = await request(app).post('/api/schedules/generate').send(FEV_2025);
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);
  });

  it('NOTURNO Fev/2025: entradas cobrindo todos os 28 dias do mes', async () => {
    const emp = await createNoturnoEmployee('Noturno Fev Full', 2, 2025);
    await request(app).post('/api/schedules/generate').send(FEV_2025);
    const schedRes = await request(app).get('/api/schedules?month=2&year=2025');
    const empEntries = schedRes.body.entries.filter((e) => e.employee_id === emp.id);
    expect(empEntries.length).toBe(28);
    const dates = empEntries.map((e) => e.date);
    for (let d = 1; d <= 28; d++) {
      const dateStr = '2025-02-' + String(d).padStart(2, '0');
      expect(dates).toContain(dateStr);
    }
  });
});
