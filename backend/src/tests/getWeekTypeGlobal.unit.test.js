/**
 * test: getWeekTypeGlobal — validação unitária para todos os 12 meses de 2026
 *
 * Tester Senior — issue #129 (parte 1)
 *
 * Testa a função getWeekTypeGlobal diretamente — sem DB, sem motoristas cadastrados.
 * Valida que o algoritmo de índice global não produz drift nos meses com 5 semanas.
 *
 * Meses de 2026 com 5 semanas CLT (gatilhos do bug #127):
 *   Mar (período 01/03–04/04), Mai (03/05–06/06), Ago (02/08–05/09), Nov (01/11–28/11... wait, ver abaixo)
 *
 * ── Calendário de domingos 2026 (cycle_start=Jan/2026) ───────────────────────
 *
 * cycleFirstSunday = 2026-01-04 (Jan 1 = Qui → +3 dias)
 * GLOBAL_PATTERN_12 = ['36h','42h','42h','36h','42h','42h','36h','42h','42h','36h','42h','42h']
 *
 * globalWi = (weekStart - 2026-01-04) / 7 dias
 *
 * Meses de 5 semanas e a semana extra:
 *   Mar: semana extra 2026-03-29 → globalWi=12 → idx%12=0 → '36h'
 *   Mai: semana extra 2026-05-31 → globalWi=21 → idx%12=9 → '36h'
 *   Ago: semana extra 2026-08-30 → globalWi=34 → idx%12=10 → '42h'
 *   Nov: semana extra 2026-11-29 → globalWi=47 → idx%12=11 → '42h'
 *
 * Mês após cada mês de 5 semanas (verificação anti-drift):
 *   Abr 1ª semana 2026-04-05 → globalWi=13 → idx%12=1 → '42h'  (old bug: '36h')
 *   Jun 1ª semana 2026-06-07 → globalWi=22 → idx%12=10 → '42h' (old bug: '42h' — coincidência)
 *   Set 1ª semana 2026-09-06 → globalWi=35 → idx%12=11 → '42h' (old bug: diferia)
 *   Dez 1ª semana 2026-12-06 → globalWi=48 → idx%12=0 → '36h'  (old bug: diferia)
 */

import { describe, it, expect } from 'vitest';
import { getWeekTypeGlobal, getFirstSundayOfMonth } from '../services/scheduleGenerator.js';

// Padrão de 12 semanas — duplicado aqui para que o teste seja auto-contido e detecte
// se o padrão no código for alterado inadvertidamente.
const GLOBAL_PATTERN_12 = [
  '36h', '42h', '42h', '36h',  // fase 1 (elapsed=0): semanas 0–3
  '42h', '42h', '36h', '42h',  // fase 2 (elapsed=1): semanas 4–7
  '42h', '36h', '42h', '42h',  // fase 3 (elapsed=2): semanas 8–11
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Gera todos os domingos do período de um mês com base em getFirstSundayOfMonth.
 * Não usa getSchedulePeriod para manter o teste isolado da lógica de período.
 */
function sundaysInPeriod(month, year) {
  const start = getFirstSundayOfMonth(year, month);
  // Fim do período = dia antes do 1º domingo do mês seguinte
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextFirstSunday = getFirstSundayOfMonth(nextYear, nextMonth);

  const sundays = [];
  const cursor = new Date(start.getTime());
  while (cursor < nextFirstSunday) {
    sundays.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return sundays;
}

/**
 * Retorna o índice global de semanas esperado para um weekStart dado cycle_start.
 * Usado nos comentários dos testes para rastrear de onde vem cada tipo esperado.
 */
function globalWi(cycleStartYear, cycleStartMonth, weekStart) {
  const cycleFirstSunday = getFirstSundayOfMonth(cycleStartYear, cycleStartMonth);
  const ws = new Date(weekStart + 'T00:00:00Z');
  return Math.round((ws.getTime() - cycleFirstSunday.getTime()) / (7 * 24 * 3600 * 1000));
}

// ── Suite 1: getFirstSundayOfMonth — 12 meses de 2026 ────────────────────────

describe('getFirstSundayOfMonth — 12 meses de 2026', () => {
  // Valores esperados calculados a partir do calendário gregoriano.
  const expected = {
    1:  '2026-01-04',  // Jan 1 = Qui → +3 = Dom Jan 4
    2:  '2026-02-01',  // Feb 1 = Dom → mesmo dia
    3:  '2026-03-01',  // Mar 1 = Dom → mesmo dia
    4:  '2026-04-05',  // Abr 1 = Qua → +4 = Dom Abr 5
    5:  '2026-05-03',  // Mai 1 = Sex → +2 = Dom Mai 3
    6:  '2026-06-07',  // Jun 1 = Seg → +6 = Dom Jun 7
    7:  '2026-07-05',  // Jul 1 = Qua → +4 = Dom Jul 5
    8:  '2026-08-02',  // Ago 1 = Sáb → +1 = Dom Ago 2
    9:  '2026-09-06',  // Set 1 = Ter → +5 = Dom Set 6
    10: '2026-10-04',  // Out 1 = Qui → +3 = Dom Out 4
    11: '2026-11-01',  // Nov 1 = Dom → mesmo dia
    12: '2026-12-06',  // Dez 1 = Ter → +5 = Dom Dez 6
  };

  for (const [m, expectedDate] of Object.entries(expected)) {
    const month = Number(m);
    it(`${String(month).padStart(2,'0')}/2026 → primeiro domingo = ${expectedDate}`, () => {
      const result = getFirstSundayOfMonth(2026, month);
      expect(result.toISOString().slice(0, 10)).toBe(expectedDate);
    });
  }
});

// ── Suite 2: todos os 52 domingos de 2026 — cycle_start=Jan/2026 ─────────────

describe('getWeekTypeGlobal — todos os 12 meses de 2026 (cycle_start=Jan/2026, sem motoristas)', () => {
  // cycleFirstSunday = 2026-01-04
  // Para cada domingo de 2026: globalWi = (domingo - 2026-01-04) / 7
  //   tipo esperado = GLOBAL_PATTERN_12[globalWi % 12]

  for (let month = 1; month <= 12; month++) {
    const label = `${String(month).padStart(2,'0')}/2026`;
    const sundays = sundaysInPeriod(month, 2026);

    it(`${label} — ${sundays.length} semana(s): tipos corretos sem drift`, () => {
      for (const weekStart of sundays) {
        const wi    = globalWi(2026, 1, weekStart);
        const expected = GLOBAL_PATTERN_12[((wi % 12) + 12) % 12];
        const actual   = getWeekTypeGlobal(2026, 1, weekStart);
        expect(actual, `${label} semana ${weekStart} (globalWi=${wi})`).toBe(expected);
      }
    });
  }
});

// ── Suite 3: verificação explícita das semanas extras (5º semana dos meses críticos) ──

describe('getWeekTypeGlobal — 5ª semana dos meses críticos não repete o padrão da 4ª semana', () => {
  // Meses com 5 semanas em 2026: Mar, Mai, Ago, Nov
  // Verifica que a 5ª semana tem tipo diferente da 1ª semana do mesmo mês
  // (se fossem iguais, indicaria uso de min(cltWi, 3) — comportamento do bug)

  it('Mar/2026: 5ª semana (2026-03-29) ≠ 1ª semana (2026-03-01)', () => {
    const w1 = getWeekTypeGlobal(2026, 1, '2026-03-01'); // globalWi=8  → '42h'
    const w5 = getWeekTypeGlobal(2026, 1, '2026-03-29'); // globalWi=12 → '36h'
    expect(w1).toBe('42h');
    expect(w5).toBe('36h');
    expect(w5, '5ª semana não deve repetir tipo da 4ª (comportamento do bug)').not.toBe(
      getWeekTypeGlobal(2026, 1, '2026-03-22') // globalWi=11 → '42h'
    );
  });

  it('Mai/2026: 5ª semana (2026-05-31) tem tipo independente das anteriores', () => {
    const w5 = getWeekTypeGlobal(2026, 1, '2026-05-31'); // globalWi=21 → '36h'
    expect(w5).toBe('36h');
    // Com o bug: cltWi=4 → min(4,3)=3 → fase 2[3]='42h' — errado
  });

  it('Ago/2026: 5ª semana (2026-08-30) tem tipo independente das anteriores', () => {
    const w5 = getWeekTypeGlobal(2026, 1, '2026-08-30'); // globalWi=34 → '42h'
    expect(w5).toBe('42h');
  });

  it('Nov/2026: 5ª semana (2026-11-29) tem tipo independente das anteriores', () => {
    const w5 = getWeekTypeGlobal(2026, 1, '2026-11-29'); // globalWi=47 → '42h'
    expect(w5).toBe('42h');
  });
});

// ── Suite 4: mês seguinte a cada mês de 5 semanas começa no índice correto ────

describe('getWeekTypeGlobal — 1ª semana do mês após mês de 5 semanas (anti-drift)', () => {
  // Se houvesse drift (bug #127), o mês seguinte começaria no índice errado.
  // Estes são os casos mais críticos: o índice global deve continuar a partir
  // da semana 5 sem reset.

  it('Abr/2026 (após Mar com 5 semanas): 1ª semana (2026-04-05) = 42h, não 36h', () => {
    // Com bug: resetava cltWi=0 → fase 1[0]='36h' — errado
    // Com fix:  globalWi=13 → GLOBAL_PATTERN_12[1]='42h' — correto
    expect(getWeekTypeGlobal(2026, 1, '2026-04-05')).toBe('42h');
  });

  it('Jun/2026 (após Mai com 5 semanas): 1ª semana (2026-06-07) = 42h', () => {
    // globalWi=22 → GLOBAL_PATTERN_12[10]='42h'
    expect(getWeekTypeGlobal(2026, 1, '2026-06-07')).toBe('42h');
  });

  it('Set/2026 (após Ago com 5 semanas): 1ª semana (2026-09-06) = 42h', () => {
    // globalWi=35 → GLOBAL_PATTERN_12[11]='42h'
    expect(getWeekTypeGlobal(2026, 1, '2026-09-06')).toBe('42h');
  });

  it('Dez/2026 (após Nov com 5 semanas): 1ª semana (2026-12-06) = 36h', () => {
    // globalWi=48 → GLOBAL_PATTERN_12[0]='36h'
    expect(getWeekTypeGlobal(2026, 1, '2026-12-06')).toBe('36h');
  });
});

// ── Suite 5: padrão repete exatamente a cada 12 semanas ───────────────────────

describe('getWeekTypeGlobal — padrão se repete a cada 12 semanas', () => {
  it('cycle_start=Jan/2026: semana 0 e semana 12 têm o mesmo tipo (36h)', () => {
    const w0  = getWeekTypeGlobal(2026, 1, '2026-01-04'); // globalWi=0  → '36h'
    const w12 = getWeekTypeGlobal(2026, 1, '2026-03-29'); // globalWi=12 → '36h'
    expect(w0).toBe('36h');
    expect(w12).toBe(w0);
  });

  it('cycle_start=Jan/2026: semana 4 e semana 16 têm o mesmo tipo (42h)', () => {
    const w4  = getWeekTypeGlobal(2026, 1, '2026-02-01'); // globalWi=4  → '42h'
    const w16 = getWeekTypeGlobal(2026, 1, '2026-04-26'); // globalWi=16 → '42h'
    expect(w4).toBe('42h');
    expect(w16).toBe(w4);
  });
});

// ── Suite 6: outros cycle_starts (cobertura de outras fases em 2026) ──────────

describe('getWeekTypeGlobal — cycle_start ≠ Jan/2026', () => {
  it('cycle_start=Mai/2026: 1ª semana (2026-05-03) = 36h (índice 0 da fase, globalWi=0)', () => {
    // cycleFirstSunday = 2026-05-03
    // weekStart = 2026-05-03 → globalWi=0 → GLOBAL_PATTERN_12[0]='36h'
    expect(getWeekTypeGlobal(2026, 5, '2026-05-03')).toBe('36h');
  });

  it('cycle_start=Mai/2026: semana após Mar 5-semanas de outro ciclo não sofre drift', () => {
    // Abr/2027 após Mar/2027 (5 semanas) — testando que o padrão global é consistente
    // cycle_start=Mai/2026, cycleFirstSunday=2026-05-03
    // 2027-03-28 (5ª semana de Mar/2027): globalWi = (2027-03-28 - 2026-05-03) / 7 = 330/7 = ?
    // (2027-03-28 - 2026-05-03): de mai/03 até mar/28 do ano seguinte
    //   mai→dez 2026: 7 meses × ~4.33 semanas ≈ mas vamos calcular exato
    //   2026-05-03 a 2027-03-28: 329 dias / 7 = 47 semanas
    // globalWi=47 → GLOBAL_PATTERN_12[11]='42h'
    expect(getWeekTypeGlobal(2026, 5, '2027-03-28')).toBe('42h');
    // 2027-04-04 (1ª semana de Abr/2027): globalWi=48 → GLOBAL_PATTERN_12[0]='36h'
    expect(getWeekTypeGlobal(2026, 5, '2027-04-04')).toBe('36h');
  });

  it('cycle_start=Set/2025: Abr/2026 (4 semanas após meses de 5 semanas) está correto', () => {
    // cycleFirstSunday = 2025-09-07 (Set 1, 2025 = Seg → +6 = Dom Set 7)
    // 2026-04-05: (2026-04-05 - 2025-09-07) / 7 = 210 dias / 7 = 30 semanas
    // globalWi=30 → GLOBAL_PATTERN_12[30%12=6]='36h'
    expect(getWeekTypeGlobal(2025, 9, '2026-04-05')).toBe('36h');
    // 2026-04-12: globalWi=31 → GLOBAL_PATTERN_12[7]='42h'
    expect(getWeekTypeGlobal(2025, 9, '2026-04-12')).toBe('42h');
  });
});
