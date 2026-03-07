/**
 * test(generator): correctHours respeita limite CLT semanal ao remover entradas -- issue #92
 *
 * Desenvolvedor Pleno
 *
 * Causa raiz (fix #92): no caminho diff>6, o sort priorizava entradas por duracao sem criterio
 * de data. Entradas da Semana 1 eram as primeiras e removidas primeiro, destruindo semanas
 * que ja estavam no limite CLT semanal.
 *
 * Regra confirmada pelo PO: exceder 160h/mes e aceitavel. correctHours NAO deve remover
 * entradas de semanas que ja estao no/abaixo do limite CLT semanal.
 *
 * Cenario principal -- DIURNO, cycle_start=Jan/2026, Marco/2026 (5 semanas completas):
 *   calculateEffectiveCycleMonth(1, 2026, 3, 2026) -> elapsed=2 -> phase=3
 *   getWeekTypeFromPhase(3, wi) -> patterns[3] = ['42h','36h','42h','42h']
 *     wi=0 -> 42h (Mar 1 = 1 dia)
 *     wi=1 -> 36h (Mar 2-8)  <-- limite=36h; bug removia entradas aqui
 *     wi=2 -> 42h (Mar 9-15)
 *     wi=3 -> 42h (Mar 16-22)
 *     wi=4 -> 42h (Mar 23-29) [clamped]
 *     wi=5 -> 42h (Mar 30-31) [clamped]
 */

import { describe, it, expect } from 'vitest';
import {
  correctHours,
  buildWeeks,
  calculateEffectiveCycleMonth,
  getWeekLimitHours,
} from '../services/scheduleGenerator.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const DIURNO_SHIFT = { id: 11, name: 'Diurno', duration_hours: 12, start_time: '07:00' };
const SHIFT_MAP = { 11: DIURNO_SHIFT };

function marchDates() {
  const dates = [];
  for (let d = 1; d <= 31; d++) {
    dates.push(`2026-03-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

function buildEntriesFromWeeks(weeks, shiftsPerWeek) {
  const entries = [];
  for (const week of weeks) {
    let assigned = 0;
    for (const date of week) {
      const isOff = assigned >= shiftsPerWeek;
      entries.push({
        date,
        shift_type_id: isOff ? null : DIURNO_SHIFT.id,
        is_day_off: isOff ? 1 : 0,
      });
      if (!isOff) assigned++;
    }
  }
  return entries;
}

function weeklyHours(entries, weekDates) {
  return entries
    .filter((e) => !e.is_day_off && e.shift_type_id && weekDates.includes(e.date))
    .reduce((sum, e) => sum + (SHIFT_MAP[e.shift_type_id]?.duration_hours || 0), 0);
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('fix #92 -- correctHours nao remove entradas de semanas dentro do limite CLT', () => {

  it('Semana 1 (36h, limite=36h) mantem 3 plantoes apos correctHours com total > 160h', () => {
    const dates = marchDates();
    const weeks = buildWeeks(dates);

    // cycle_start=Jan/2026, genMes=Mar/2026 -> elapsed=2 -> phase=3
    const effectiveCycleMonth = calculateEffectiveCycleMonth(1, 2026, 3, 2026);
    expect(effectiveCycleMonth).toBe(3);

    expect(weeks.length).toBeGreaterThanOrEqual(5);

    // buildWeeks: Domingo inicia nova semana (Dom entra na nova semana)
    // Semana 0: Mar 1(Dom)-Mar 7(Sab); Semana 1: Mar 8(Dom)-Mar 14(Sab)
    // wi=1 -> patterns[3][1] = '36h' -> limite CLT = 36h (bug removia entradas aqui)
    const week1 = weeks[1];
    expect(week1[0]).toBe('2026-03-08');
    expect(week1[week1.length - 1]).toBe('2026-03-14');

    // 3 plantoes/semana:
    // S0(7d):3*12=36h; S1(7d):3*12=36h; S2(7d):3*12=36h; S3(7d):3*12=36h; S4(3d):2*12=24h
    // Total bruto: ~168h -> diff > 6h -> correctHours acionado
    const entries = buildEntriesFromWeeks(weeks, 3);
    const totalHours = entries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (SHIFT_MAP[e.shift_type_id]?.duration_hours || 0)),
      0
    );

    // Confirmar total > 160h (aciona caminho diff > 6 do correctHours)
    expect(totalHours).toBeGreaterThan(160);

    // Semana 1 antes: exatamente no limite CLT (36h)
    const week1HoursBefore = weeklyHours(entries, week1);
    expect(week1HoursBefore).toBe(36);

    // Executar correctHours com contexto de semanas
    const corrected = correctHours(
      entries,
      [DIURNO_SHIFT],
      SHIFT_MAP,
      totalHours,
      160,
      DIURNO_SHIFT,
      new Set(),
      weeks,
      effectiveCycleMonth
    );

    // Semana 1 NAO deve ter sido reduzida -- estava no limite CLT
    const week1HoursAfter = weeklyHours(corrected, week1);
    expect(week1HoursAfter).toBe(36);

    // Total pode ser > 160h (aceitavel -- regra CLT e media de 3 meses)
    const finalHours = corrected.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (SHIFT_MAP[e.shift_type_id]?.duration_hours || 0)),
      0
    );
    expect(finalHours).toBeGreaterThanOrEqual(160);
  });

  it('getWeekLimitHours retorna tipo correto: DIURNO 36h->hours/36, ADM 36h->shifts/3', () => {
    expect(getWeekLimitHours(false, false, '36h')).toEqual({ type: 'hours', limit: 36 });
    expect(getWeekLimitHours(false, false, '42h')).toEqual({ type: 'hours', limit: 42 });
    expect(getWeekLimitHours(true,  false, '36h')).toEqual({ type: 'shifts', limit: 3 });
    expect(getWeekLimitHours(true,  false, '42h')).toEqual({ type: 'shifts', limit: 4 });
  });

  it('sem contexto de semanas (weeks=[]), correctHours reduz horas normalmente (backward-compat)', () => {
    const dates = marchDates();
    const weeks = buildWeeks(dates);

    // 5 plantoes por semana -- total muito alto
    const entries = buildEntriesFromWeeks(weeks, 5);
    const totalHours = entries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (SHIFT_MAP[e.shift_type_id]?.duration_hours || 0)),
      0
    );
    expect(totalHours).toBeGreaterThan(166);

    const corrected = correctHours(
      entries,
      [DIURNO_SHIFT],
      SHIFT_MAP,
      totalHours,
      160,
      DIURNO_SHIFT,
      new Set(),
      [],   // weeks vazio -- guard CLT desativado
      null  // effectiveCycleMonth null -- guard CLT desativado
    );

    const finalHours = corrected.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (SHIFT_MAP[e.shift_type_id]?.duration_hours || 0)),
      0
    );
    // Sem o guard CLT, correctHours deve ter reduzido para proximo de 160h
    expect(Math.abs(finalHours - 160)).toBeLessThanOrEqual(18);
  });
});
