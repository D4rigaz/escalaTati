import { getDb, runTransaction } from '../db/database.js';
import { format } from 'date-fns';

/**
 * Retorna o período real da escala para um dado mês/ano.
 * Início: primeiro domingo do mês M.
 * Fim: sábado anterior ao primeiro domingo do mês M+1.
 * Garante semanas sempre completas (Dom→Sáb) — sem semana parcial no início.
 *
 * Exemplos:
 *   Abril/2026: 05/04 → 02/05 (4 semanas completas)
 *   Março/2026: 01/03 → 04/04 (5 semanas — dia 01 já é domingo)
 */
export function getSchedulePeriod(month, year) {
  const firstDay = new Date(year, month - 1, 1);
  const dow = firstDay.getDay(); // 0=Dom
  const daysToSun = dow === 0 ? 0 : 7 - dow;
  const start = new Date(year, month - 1, 1 + daysToSun);

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const firstDayNext = new Date(nextYear, nextMonth - 1, 1);
  const dowNext = firstDayNext.getDay();
  const daysToSunNext = dowNext === 0 ? 0 : 7 - dowNext;
  const nextFirstSun = new Date(nextYear, nextMonth - 1, 1 + daysToSunNext);

  const end = new Date(nextFirstSun);
  end.setDate(end.getDate() - 1); // sábado anterior ao próximo primeiro domingo

  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate:   format(end,   'yyyy-MM-dd'),
  };
}

// Pares de nomes que formam um "emendado" válido (sem descanso entre eles)
export const EMENDADO_PAIRS = [
  ['Manhã', 'Tarde'],    // 07:00–13:00 + 13:00–19:00 = 12h diurno (regra 11)
  ['Tarde', 'Noturno'],  // 13:00–19:00 + 19:00–07:00 = 18h
  ['Noturno', 'Manhã'],  // 19:00–07:00 + 07:00–13:00 = 18h
];

const MIN_REST_HOURS           = 24;  // Fixo, não editável (regra 10)
const MAX_CONSECUTIVE_HOURS    = 18;  // Regra: máximo 18h consecutivas
const MAX_CONSECUTIVE_WORK_DAYS = 6;  // Regra: máximo 6 dias de trabalho consecutivos
const MIN_DAILY_COVERAGE        = 2;  // Regra 42: mínimo 2 motoristas por dia (issue #42)
const TARGET_HOURS          = 160;
const DEFAULT_SHIFT_HOURS   = 12;   // Padrão esperado: plantão de 12 horas
const SETOR_ADM             = 'Transporte Administrativo';
const SETOR_AMBUL           = 'Transporte Ambulância';
const SETOR_HEMO            = 'Transporte Hemodiálise';
const SHIFT_ADM_NAME        = 'Administrativo'; // 10h
const SHIFT_DIURNO_NAME     = 'Diurno';         // 12h (regra 16)
const SHIFT_NOTURNO_NAME    = 'Noturno';        // 12h (regras 21/22)
const SHIFT_MANHA_NAME      = 'Manhã';          //  6h (extra 42h — issue #65)
const SHIFT_TARDE_NAME      = 'Tarde';          //  6h (extra 42h — issue #65)

/**
 * Verifica se dois turnos formam um emendado válido (sem descanso).
 */
export function isValidEmendado(prevShiftName, nextShiftName) {
  return EMENDADO_PAIRS.some(
    ([a, b]) => a === prevShiftName && b === nextShiftName
  );
}

/**
 * Calcula a fase do ciclo CLT (1, 2 ou 3) a partir da data de início do ciclo
 * do motorista e do mês de geração.
 * @param {number} cycleStartMonth - Mês de início do ciclo (1–12).
 * @param {number} cycleStartYear  - Ano de início do ciclo.
 * @param {number} genMonth        - Mês da geração (1–12).
 * @param {number} genYear         - Ano da geração.
 * @returns {1|2|3}
 */
export function calculateEffectiveCycleMonth(cycleStartMonth, cycleStartYear, genMonth, genYear) {
  const elapsed = (genYear * 12 + genMonth) - (cycleStartYear * 12 + cycleStartMonth);
  return ((elapsed % 3) + 3) % 3 + 1;
}

/**
 * Retorna o label contábil CLT da semana para um motorista.
 * @param {number} cycleMonth - Fase do ciclo do motorista (1, 2 ou 3).
 * @param {number} genMonth   - Mês da geração (1–12).
 * @param {number} weekIndex  - Índice da semana no mês (0-based, clamped em 3).
 * @returns {'36h' | '42h'}
 */
export function getWeekType(cycleMonth, genMonth, weekIndex) {
  const patterns = [
    ['36h', '42h', '42h', '36h'],  // fase 1
    ['42h', '42h', '36h', '42h'],  // fase 2
    ['42h', '36h', '42h', '42h'],  // fase 3
  ];
  const actualCycle = ((genMonth - 1 + cycleMonth - 1) % 3);
  return patterns[actualCycle][Math.min(weekIndex, 3)];
}

/**
 * Retorna o limite físico semanal CLT para o motorista.
 * ADM: limite por número de turnos (3 ou 4) — shifts de 10h ou 12h (fallback).
 * Não-ADM (NOTURNO e DIURNO): limite em horas — semana 36h = 36h (3×12h), semana 42h = 42h (3×12h + 1×6h).
 * Issue #90: turno extra 6h em semana 42h se aplica a NOTURNO e DIURNO.
 *
 * @param {boolean} isAdm
 * @param {boolean} isNoturno
 * @param {'36h'|'42h'} weekType
 * @returns {{ type: 'shifts'|'hours', limit: number }}
 */
export function getWeekLimitHours(isAdm, isNoturno, weekType) {
  if (isAdm) {
    // ADM usa limite de turnos (não horas) porque o gerador pode usar shifts de 10h ou 12h
    return { type: 'shifts', limit: weekType === '36h' ? 3 : 4 };
  }
  // Não-ADM (NOTURNO e DIURNO): turno extra 6h em semana 42h (#65, #90)
  return { type: 'hours', limit: weekType === '36h' ? 36 : 42 };
}

/**
 * Retorna as horas trabalhadas por um employee em um intervalo semanal específico (DB).
 * @param {object} db
 * @param {number} employeeId
 * @param {string} weekStart - Data inicial (yyyy-MM-dd, inclusive)
 * @param {string} weekEnd   - Data final   (yyyy-MM-dd, inclusive)
 * @returns {number}
 */
function getWeeklyHours(db, employeeId, weekStart, weekEnd) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(st.duration_hours), 0) as total
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ? AND se.date >= ? AND se.date <= ? AND se.is_day_off = 0`
  ).get(employeeId, weekStart, weekEnd);
  return row?.total ?? 0;
}

/**
 * Retorna o número de turnos de trabalho (entradas não-folga) de um employee
 * em um intervalo semanal específico (DB).
 * @param {object} db
 * @param {number} employeeId
 * @param {string} weekStart
 * @param {string} weekEnd
 * @returns {number}
 */
function getWeeklyShiftCount(db, employeeId, weekStart, weekEnd) {
  const row = db.prepare(
    `SELECT COUNT(*) as total
     FROM schedule_entries se
     WHERE se.employee_id = ? AND se.date >= ? AND se.date <= ? AND se.is_day_off = 0`
  ).get(employeeId, weekStart, weekEnd);
  return row?.total ?? 0;
}

/**
 * Retorna o label CLT da semana usando a fase direta (sem rotação adicional por genMonth).
 * Usar em conjunto com calculateEffectiveCycleMonth.
 * @param {1|2|3} phase    - Fase retornada por calculateEffectiveCycleMonth
 * @param {number} weekIndex
 * @returns {'36h' | '42h'}
 */
function getWeekTypeFromPhase(phase, weekIndex) {
  const patterns = [
    null,
    ['36h', '42h', '42h', '36h'],  // fase 1
    ['42h', '42h', '36h', '42h'],  // fase 2
    ['42h', '36h', '42h', '42h'],  // fase 3
  ];
  return patterns[phase][Math.min(weekIndex, 3)];
}

/**
 * Retorna o primeiro domingo do mês como objeto Date (meia-noite UTC).
 * @param {number} year
 * @param {number} month - 1-based
 * @returns {Date}
 */
export function getFirstSundayOfMonth(year, month) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dow = firstDay.getUTCDay(); // 0 = Domingo
  const daysToSun = dow === 0 ? 0 : 7 - dow;
  return new Date(Date.UTC(year, month - 1, 1 + daysToSun));
}

/**
 * Calcula o tipo de semana CLT usando índice global a partir do primeiro domingo
 * do mês de início do ciclo do funcionário.
 *
 * Fix #127: substitui o índice local (cltWi) + calculateEffectiveCycleMonth por um
 * índice global que não acumula deslocamento em meses com 5 semanas.
 *
 * Padrões por fase (determinada pelo cycle_start_month):
 *   Fase 1 (cycle_start Jan–Abr): ['36h','42h','42h','36h']
 *   Fase 2 (cycle_start Mai–Ago): ['42h','42h','36h','42h']
 *   Fase 3 (cycle_start Set–Dez): ['42h','36h','42h','42h']
 *
 * @param {number} cycleStartYear
 * @param {number} cycleStartMonth - 1-based
 * @param {Date|string} weekStart  - Data (Date UTC ou string 'yyyy-MM-dd') do início da semana
 * @returns {'36h' | '42h'}
 */
export function getWeekTypeGlobal(cycleStartYear, cycleStartMonth, weekStart) {
  // Padrão global de 12 semanas (3 meses × 4 semanas/mês):
  //   Semanas 0–3  (fase 1 do ciclo, elapsed=0): ['36h','42h','42h','36h']
  //   Semanas 4–7  (fase 2 do ciclo, elapsed=1): ['42h','42h','36h','42h']
  //   Semanas 8–11 (fase 3 do ciclo, elapsed=2): ['42h','36h','42h','42h']
  // Concatenados: 12 semanas que se repetem a cada ciclo de 3 meses.
  const GLOBAL_PATTERN_12 = [
    '36h', '42h', '42h', '36h',  // fase 1 (elapsed=0)
    '42h', '42h', '36h', '42h',  // fase 2 (elapsed=1)
    '42h', '36h', '42h', '42h',  // fase 3 (elapsed=2)
  ];

  // Primeiro domingo do mês de cycle_start
  const cycleFirstSunday = getFirstSundayOfMonth(cycleStartYear, cycleStartMonth);

  // weekStart como Date UTC
  const weekStartDate = typeof weekStart === 'string'
    ? new Date(weekStart + 'T00:00:00Z')
    : weekStart;

  // Índice global de semanas desde o cycleFirstSunday (pode ser negativo)
  const globalWeekIdx = Math.round(
    (weekStartDate.getTime() - cycleFirstSunday.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  return GLOBAL_PATTERN_12[((globalWeekIdx % 12) + 12) % 12];
}

// Configuração mínima de crew recomendada (decisão PO — issue #108)
const MIN_HEMO_WORKERS   = 4; // para garantir R5: ≥2 Hemo Diurno em todos os dias úteis
const MIN_AMB_NOTURNO    = 4; // para garantir R3: ≥2 Noturno Amb em Qui/Sáb
const MIN_DOM_SAB_WORKERS = 4; // para garantir MIN_DAILY_COVERAGE/dia incl. fins de semana (issue #115)

/**
 * Verifica se o elenco ativo atende à configuração mínima recomendada.
 * Retorna array de crew_warnings (vazio se tudo OK).
 */
function checkCrewMinimum(db, shiftTypes) {
  const crew_warnings = [];
  const noturnoShift = shiftTypes.find((s) => s.name === SHIFT_NOTURNO_NAME);

  const hemoCount = db.prepare(
    `SELECT COUNT(DISTINCT e.id) as c FROM employees e
     JOIN employee_sectors es ON es.employee_id = e.id
     WHERE e.active = 1 AND es.setor = ?`
  ).get(SETOR_HEMO).c;

  if (hemoCount < MIN_HEMO_WORKERS) {
    crew_warnings.push({
      type: 'crew_hemo_insuficiente',
      message: `Cobertura Diurno Hemodiálise pode ser insuficiente: ${hemoCount}/${MIN_HEMO_WORKERS} workers ativos (mínimo recomendado para garantir ≥2/dia útil)`,
    });
  }

  const ambNoturnoCount = noturnoShift
    ? db.prepare(
        `SELECT COUNT(DISTINCT e.id) as c FROM employees e
         JOIN employee_sectors es ON es.employee_id = e.id
         LEFT JOIN employee_rest_rules r ON r.employee_id = e.id
         WHERE e.active = 1 AND es.setor = ? AND r.preferred_shift_id = ?`
      ).get(SETOR_AMBUL, noturnoShift.id).c
    : 0;

  if (ambNoturnoCount < MIN_AMB_NOTURNO) {
    crew_warnings.push({
      type: 'crew_amb_noturno_insuficiente',
      message: `Cobertura Noturno Ambulância pode ser insuficiente: ${ambNoturnoCount}/${MIN_AMB_NOTURNO} workers com turno Noturno preferido (mínimo recomendado para garantir ≥2 em Qui/Sáb)`,
    });
  }

  const domSabCount = db.prepare(
    `SELECT COUNT(*) as c FROM employees WHERE active = 1 AND work_schedule != 'seg_sex'`
  ).get().c;

  if (domSabCount < MIN_DOM_SAB_WORKERS) {
    crew_warnings.push({
      type: 'crew_dom_sab_insuficiente',
      message: `Cobertura diária geral pode ser insuficiente: ${domSabCount}/${MIN_DOM_SAB_WORKERS} workers dom_sab ativos (mínimo recomendado para garantir ≥${MIN_DAILY_COVERAGE}/dia incluindo fins de semana)`,
    });
  }

  return crew_warnings;
}

/**
 * Main schedule generation algorithm (greedy + correction step)
 * Target: 160h/month per employee
 */
export async function generateSchedule({ month, year, overwriteLocked = false }) {
  const db = getDb();

  const employees = db.prepare('SELECT * FROM employees WHERE active = 1').all();
  const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
  const shiftMap = {};
  for (const s of shiftTypes) shiftMap[s.id] = s;

  const diurnoShift  = shiftTypes.find((s) => s.name === SHIFT_DIURNO_NAME);
  const noturnoShift = shiftTypes.find((s) => s.name === SHIFT_NOTURNO_NAME);

  const { startDate: periodStart, endDate: periodEnd } = getSchedulePeriod(month, year);
  const dates = [];
  const cursor = new Date(periodStart + 'T12:00:00');
  const periodEndDate = new Date(periodEnd + 'T12:00:00');
  while (cursor <= periodEndDate) {
    dates.push(format(cursor, 'yyyy-MM-dd'));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Load employee sectors
  const employeeIds = employees.map((e) => e.id);
  const employeeSectorsMap = {};
  if (employeeIds.length > 0) {
    const allSectors = db.prepare('SELECT employee_id, setor FROM employee_sectors').all();
    for (const s of allSectors) {
      if (!employeeSectorsMap[s.employee_id]) employeeSectorsMap[s.employee_id] = [];
      employeeSectorsMap[s.employee_id].push(s.setor);
    }
  }
  for (const emp of employees) {
    emp.setores = employeeSectorsMap[emp.id] || [];
  }

  // Load vacation dates: Set of "employeeId:YYYY-MM-DD"
  const allVacationDates = new Set();
  if (employeeIds.length > 0) {
    const vacRows = db
      .prepare('SELECT employee_id, start_date, end_date FROM employee_vacations')
      .all();
    for (const v of vacRows) {
      let cursor = v.start_date;
      while (cursor <= v.end_date) {
        allVacationDates.add(`${v.employee_id}:${cursor}`);
        const [y, m, day] = cursor.split('-').map(Number);
        cursor = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
      }
    }
  }

  const crew_warnings = checkCrewMinimum(db, shiftTypes);
  const warnings = [];
  const results = [];

  for (const employee of employees) {
    const result = runTransaction(() => {
      return generateForEmployee(
        db, employee, shiftTypes, shiftMap, dates,
        overwriteLocked, warnings, allVacationDates, month, year
      );
    });
    results.push(result);
  }

  // Post-generation coverage checks (Rules 16, 19, 21, 22)
  if (diurnoShift) {
    enforceDiurnoCoverage(db, employees, employeeSectorsMap, dates, diurnoShift, warnings);
  }
  if (noturnoShift) {
    enforceNocturnalCoverage(db, employees, employeeSectorsMap, dates, noturnoShift, warnings);
  }
  enforceDailyCoverage(db, employees, employeeSectorsMap, shiftTypes, dates, warnings);

  // Log generation
  db.prepare(
    'INSERT INTO schedule_generations (month, year, params_json) VALUES (?, ?, ?)'
  ).run(month, year, JSON.stringify({ overwriteLocked, employeeCount: employees.length, warnings, results }));

  return { results, warnings, crew_warnings };
}

function generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings, allVacationDates, genMonth, genYear) {
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id) || { min_rest_hours: MIN_REST_HOURS, preferred_shift_id: null };

  // Load existing locked entries
  const lockedEntries = db
    .prepare(
      'SELECT * FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ? AND is_locked = 1'
    )
    .all(employee.id, dates[0], dates[dates.length - 1]);

  const lockedDates = new Set(lockedEntries.map((e) => e.date));

  // Clear entries
  if (overwriteLocked) {
    db.prepare('DELETE FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ?')
      .run(employee.id, dates[0], dates[dates.length - 1]);
  } else {
    db.prepare('DELETE FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ? AND is_locked = 0')
      .run(employee.id, dates[0], dates[dates.length - 1]);
  }

  const setores = employee.setores || [];
  const isAdm = setores.includes(SETOR_ADM);
  const isSegSex = employee.work_schedule === 'seg_sex';

  // Turnos de 6h (Manhã/Tarde) nunca são selecionados automaticamente pelo
  // selectShift no ciclo normal de trabalho — somente via lógica extra-42h (#65).
  const twelveHourShifts = shiftTypes.filter((s) => s.duration_hours === DEFAULT_SHIFT_HOURS);

  // Vacation dates for this employee
  const vacationDatesForEmp = new Set(
    dates.filter((d) => allVacationDates.has(`${employee.id}:${d}`))
  );

  // Determine preferred shift based on sector
  const preferredShift = rules.preferred_shift_id
    ? shiftTypes.find((s) => s.id === rules.preferred_shift_id)
    : isAdm
      ? shiftTypes.find((s) => s.name === SHIFT_ADM_NAME)
      : shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) || shiftTypes[0];
  const baseShiftHours = preferredShift?.duration_hours || DEFAULT_SHIFT_HOURS;

  // Build weekly groups (Sun-based)
  const weeks = buildWeeks(dates);

  // Fix #127: effectiveCycleMonth (índice local 1|2|3) foi substituído por
  // getWeekTypeGlobal que usa índice global baseado no cycle_start do funcionário.
  // Mantém-se apenas o cltWeekOffset para detectar semanas parciais.
  // Issue #96: Detectar semanas parciais (< 7 dias) no início e fim do mês.
  // Meses que não começam num domingo têm uma semana inicial parcial.
  // O índice CLT (wi) deve contar apenas a partir da primeira semana COMPLETA.
  // Semanas parciais não recebem meta CLT — escalamos o que couber com rest ≥ 24h.
  const firstWeekIsPartial = weeks.length > 0 && weeks[0].length < 7;
  // cltWeekOffset: quantas semanas parciais há antes das semanas completas (0 ou 1)
  const cltWeekOffset = firstWeekIsPartial ? 1 : 0;

  let totalHours = 0;
  let lastShiftEnd = null;
  let lastShiftName = null;
  let consecutiveHours = 0;
  const entries = [];
  // Vacation and seg_sex forced-off weekend dates — preserved by correctHours
  const segSexForcedOff = isSegSex
    ? new Set(dates.filter((d) => {
        if (lockedDates.has(d) || vacationDatesForEmp.has(d)) return false;
        const dow = new Date(d + 'T12:00:00').getDay();
        return dow === 0 || dow === 6;
      }))
    : new Set();
  const lockedOffDates = new Set([...vacationDatesForEmp, ...segSexForcedOff]);

  // Count locked hours
  for (const entry of lockedEntries) {
    if (!entry.is_day_off && entry.shift_type_id) {
      const shift = shiftMap[entry.shift_type_id];
      if (shift) totalHours += shift.duration_hours;
    }
  }

  const lockedWorkHours = totalHours;
  const remainingHours = Math.max(0, TARGET_HOURS - lockedWorkHours);

  if (isAdm) {
    // Ciclo 36/42/42 para Administrativo (10h/turno)
    for (let wi = 0; wi < weeks.length; wi++) {
      const week = weeks[wi];

      // Split into vacation, forced-off (seg_sex weekend), and workable days
      const vacInWeek = week.filter((d) => vacationDatesForEmp.has(d) && !lockedDates.has(d));
      const forcedOff = isSegSex
        ? week.filter((d) => {
            if (lockedDates.has(d) || vacationDatesForEmp.has(d)) return false;
            const dow = new Date(d + 'T12:00:00').getDay();
            return dow === 0 || dow === 6;
          })
        : [];
      const freeInWeek = week.filter(
        (d) => !lockedDates.has(d) && !vacationDatesForEmp.has(d) && !forcedOff.includes(d)
      );

      // Add vacation day-offs
      for (const date of vacInWeek) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: 'Férias' });
        consecutiveHours = 0;
        lastShiftName = null;
      }
      // Add forced off (seg_sex weekends)
      for (const date of forcedOff) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
        consecutiveHours = 0;
        lastShiftName = null;
      }

      // Issue #96: wi CLT começa em 0 na primeira semana COMPLETA.
      // Se a semana atual é parcial (cltWi < 0), escalar sem meta CLT (usa máx 3 turnos conservador).
      const cltWi = wi - cltWeekOffset;
      // Fix #127: usar índice global baseado no cycle_start do funcionário
      const weekTypeAdm = cltWi >= 0
        ? getWeekTypeGlobal(
            employee.cycle_start_year ?? genYear,
            employee.cycle_start_month ?? 1,
            week[0]
          )
        : '36h'; // semana parcial: sem meta CLT — usa 3 turnos como padrão conservador
      const maxTurnosNaSemana = weekTypeAdm === '36h' ? 3 : 4;
      const maxWorkInWeek = Math.min(freeInWeek.length, maxTurnosNaSemana);
      const actualOffInWeek = freeInWeek.length - Math.max(0, maxWorkInWeek);

      const selectedOff = selectOffDays(freeInWeek, actualOffInWeek, employee.id);
      const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

      for (const date of selectedWork) {
        const shift = selectShift(twelveHourShifts, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
        if (shift) {
          entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0, notes: null });
          totalHours += shift.duration_hours;

          const shiftStart = computeShiftStart(date, shift);
          const restHours = lastShiftEnd
            ? (shiftStart - lastShiftEnd) / (1000 * 60 * 60)
            : Infinity;

          consecutiveHours = restHours === 0
            ? consecutiveHours + shift.duration_hours
            : shift.duration_hours;

          lastShiftEnd = computeShiftEnd(date, shift);
          lastShiftName = shift.name;
        } else {
          entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
          consecutiveHours = 0;
          lastShiftName = null;
        }
      }

      for (const date of selectedOff) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
        consecutiveHours = 0;
        lastShiftName = null;
      }
    }
  } else {
    // Ambulância / Hemodiálise — plantão 12h, meta 160h/mês
    // Não-ADM: sempre 3 plantões/semana (label 36h/42h determina se há turno extra 6h).
    // Semana 42h + motorista NOTURNO → adiciona 1 turno extra de 6h (Manhã ou Tarde) — issue #65.

    const isNoturno = preferredShift?.name === SHIFT_NOTURNO_NAME;
    const manhaShift = shiftTypes.find((s) => s.name === SHIFT_MANHA_NAME);
    const tardeShift = shiftTypes.find((s) => s.name === SHIFT_TARDE_NAME);

    for (let wi = 0; wi < weeks.length; wi++) {
      const week = weeks[wi];

      const vacInWeek = week.filter((d) => vacationDatesForEmp.has(d) && !lockedDates.has(d));
      const forcedOff = isSegSex
        ? week.filter((d) => {
            if (lockedDates.has(d) || vacationDatesForEmp.has(d)) return false;
            const dow = new Date(d + 'T12:00:00').getDay();
            return dow === 0 || dow === 6;
          })
        : [];
      const freeInWeek = week.filter(
        (d) => !lockedDates.has(d) && !vacationDatesForEmp.has(d) && !forcedOff.includes(d)
      );

      // Add vacation day-offs
      for (const date of vacInWeek) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: 'Férias' });
        consecutiveHours = 0;
        lastShiftName = null;
      }
      // Add forced off (seg_sex weekends)
      for (const date of forcedOff) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
        consecutiveHours = 0;
        lastShiftName = null;
      }

      // Issue #90 — DIURNO em semana 42h: nova abordagem aprovada pelo PO.
      // Seleciona 4 posições com espaçamento de 2 dias (índices 0,2,4,6 em available),
      // garantindo rest ≥ 36h entre qualquer par DIURNO(19:00)→DIURNO(07:00) do próximo dia.
      // Rotaciona qual posição recebe o turno extra de 6h via employee.id % 4.
      // Issue #96: wi CLT começa em 0 na primeira semana COMPLETA.
      // Semanas parciais (cltWi < 0) → '36h' como fallback (3 plantões, sem extra 6h).
      const cltWi = wi - cltWeekOffset;
      // Fix #127: usar índice global baseado no cycle_start do funcionário
      const weekType = cltWi >= 0
        ? getWeekTypeGlobal(
            employee.cycle_start_year ?? genYear,
            employee.cycle_start_month ?? 1,
            week[0]
          )
        : '36h'; // semana parcial: sem meta CLT — sem turno extra 6h
      // Fix #119: null-preferred workers must NOT enter the Diurno42h path.
      // The Diurno42h grid (positions 0,2,4,6) relies on fix #100's skippedAny to protect rest,
      // but skippedAny aborts the extra 6h shift, yielding 36h instead of 42h.
      // Workers with preferred_shift_id=null fall through to the else branch where
      // natural emendado patterns (Noturno→Manhã etc.) correctly produce 42h.
      const isDiurno42h = !isNoturno && weekType === '42h' && rules.preferred_shift_id !== null;
      // Fix #150: null-preferred (preferred_shift_id=null) non-Noturno workers in CLT 42h weeks
      // need the same 4-position grid as isDiurno42h to guarantee 3×12h + 1×6h = 42h.
      // Cannot use isDiurno42h (requires preferredShift !== null). Uses selectShift for 12h.
      const isNullPreferred42h = !isNoturno && weekType === '42h' && rules.preferred_shift_id === null && cltWi >= 0;

      if (isDiurno42h) {
        // Dias disponíveis da semana (não locked, não vacation)
        const available = freeInWeek.filter(
          (d) => !lockedDates.has(d) && !vacationDatesForEmp.has(d)
        );

        // Posições 0, 2, 4, 6 — espaçamento de 2 dias
        const activePositions = [0, 2, 4, 6].filter((i) => i < available.length);

        // Fix #98B: activeDates construído incrementalmente — posições com rest < 24h
        // (cross-week Sáb→Dom: lastShiftEnd da semana anterior pode violar MIN_REST_HOURS)
        // são excluídas e caem no loop de folgas abaixo.
        const activeDates = new Set();

        if (activePositions.length > 0) {
          // Qual posição recebe o turno extra de 6h (Manhã ou Tarde)
          const extraPositionIndex = employee.id % activePositions.length;

          // Fix #100: se qualquer posição for pulada por rest cross-week, as posições
          // restantes devem receber 12h (não 6h), garantindo 36h uniformes.
          let skippedAny = false;

          for (let pi = 0; pi < activePositions.length; pi++) {
            const date = available[activePositions[pi]];

            // Fix #98B: verifica rest cross-semana antes de colocar o turno.
            // Sáb DIURNO (semana N) termina 19:00; Dom DIURNO (semana N+1) começa 07:00 = 12h < 24h.
            // Se o descanso for insuficiente e não for emendado válido, pula esta posição (vira folga).
            // Fix #145: PO rule — "próximo domingo é sempre uma nova semana". Para pi=0 (domingo
            // de início de semana), o rest cross-semana não bloqueia: cada semana 42h parte do zero,
            // garantindo que a meta de 42h seja sempre atingida no caminho isDiurno42h.
            if (lastShiftEnd && pi > 0) {
              const shiftRef = (!skippedAny && pi === extraPositionIndex) ? (manhaShift || tardeShift) : preferredShift;
              if (shiftRef) {
                const dStart = computeShiftStart(date, shiftRef);
                if (dStart) {
                  const restHours = (dStart - lastShiftEnd) / (1000 * 60 * 60);
                  if (restHours >= 0 && restHours < MIN_REST_HOURS) {
                    if (!isValidEmendado(lastShiftName, shiftRef.name)) {
                      skippedAny = true;
                      continue;
                    }
                  }
                }
              }
            }

            activeDates.add(date);
            if (!skippedAny && pi === extraPositionIndex) {
              // Turno extra de 6h
              const extraShift = manhaShift || tardeShift;
              if (extraShift) {
                entries.push({ employee_id: employee.id, shift_type_id: extraShift.id, date, is_day_off: 0, is_locked: 0, notes: null });
                totalHours += extraShift.duration_hours;
                lastShiftEnd = computeShiftEnd(date, extraShift);
                lastShiftName = extraShift.name;
                consecutiveHours = extraShift.duration_hours;
              }
            } else {
              // Turno Diurno 12h
              entries.push({ employee_id: employee.id, shift_type_id: preferredShift.id, date, is_day_off: 0, is_locked: 0, notes: null });
              totalHours += preferredShift.duration_hours;
              lastShiftEnd = computeShiftEnd(date, preferredShift);
              lastShiftName = preferredShift.name;
              consecutiveHours = preferredShift.duration_hours;
            }
          }
        }

        // Dias restantes da semana = folga (inclui posições puladas pelo check de rest acima)
        for (const date of freeInWeek) {
          if (!activeDates.has(date)) {
            entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
            consecutiveHours = 0;
            lastShiftName = null;
          }
        }
      } else {
        // Fluxo normal: NOTURNO, ADM, DIURNO 36h, etc.

        // Fix #98A: DIURNO em semana parcial — aplica espaçamento de posições pares [0,2,...]
        // para evitar turnos consecutivos com rest < 24h (ex: Qua→Qui em Abr/2026).
        // Posições pares garantem pelo menos 1 dia de folga entre turnos DIURNO consecutivos.
        const isDiurnoPartialWeek = !isNoturno && cltWi < 0;

        if (isDiurnoPartialWeek) {
          // Fix #104B: rotacionar posição de início por employee.id % 2 para distribuir
          // motoristas em dias diferentes da semana parcial, evitando que todos fiquem
          // concentrados nos mesmos dias e causem enforcement com rest < 24h.
          const rotOffset = employee.id % 2;
          const evenPositions = [rotOffset, rotOffset + 2, rotOffset + 4, rotOffset + 6].filter((i) => i < freeInWeek.length);
          const diurnoPartialWorkDates = new Set();

          for (const pi of evenPositions) {
            const date = freeInWeek[pi];
            // Check rest from lastShiftEnd (pode ser cross-semana ou início do mês)
            if (lastShiftEnd && preferredShift) {
              const dStart = computeShiftStart(date, preferredShift);
              if (dStart) {
                const restHours = (dStart - lastShiftEnd) / (1000 * 60 * 60);
                if (restHours >= 0 && restHours < MIN_REST_HOURS) continue;
              }
            }
            diurnoPartialWorkDates.add(date);
          }

          const shiftsForSelectPartial = (rules.preferred_shift_id && !isNoturno) ? [preferredShift] : twelveHourShifts;
          for (const date of freeInWeek) {
            if (diurnoPartialWorkDates.has(date)) {
              const shift = selectShift(shiftsForSelectPartial, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
              if (shift) {
                entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0, notes: null });
                totalHours += shift.duration_hours;
                const shiftStart = computeShiftStart(date, shift);
                const restHours = lastShiftEnd
                  ? (shiftStart - lastShiftEnd) / (1000 * 60 * 60)
                  : Infinity;
                consecutiveHours = restHours === 0
                  ? consecutiveHours + shift.duration_hours
                  : shift.duration_hours;
                lastShiftEnd = computeShiftEnd(date, shift);
                lastShiftName = shift.name;
              } else {
                entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
                consecutiveHours = 0;
                lastShiftName = null;
              }
            } else {
              entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
              consecutiveHours = 0;
              lastShiftName = null;
            }
          }
        } else if (isNullPreferred42h) {
          // Fix #150: null-preferred workers in CLT 42h weeks: 3×12h + 1×6h = 42h.
          // Same 4-position grid (indices 0,2,4,6) as isDiurno42h; selectShift for 12h positions.
          const available = freeInWeek.filter(
            (d) => !lockedDates.has(d) && !vacationDatesForEmp.has(d)
          );
          const activePositions = [0, 2, 4, 6].filter((i) => i < available.length);
          const activeDates = new Set();

          if (activePositions.length > 0) {
            const extraPositionIndex = employee.id % activePositions.length;
            let skippedAny = false;

            for (let pi = 0; pi < activePositions.length; pi++) {
              const date = available[activePositions[pi]];

              // Fix #145 PO rule: pi=0 (first day of week) never blocked by cross-week rest.
              if (lastShiftEnd && pi > 0) {
                const shiftRef = (!skippedAny && pi === extraPositionIndex)
                  ? (manhaShift || tardeShift)
                  : (twelveHourShifts[0] || null);
                if (shiftRef) {
                  const dStart = computeShiftStart(date, shiftRef);
                  if (dStart) {
                    const restHours = (dStart - lastShiftEnd) / (1000 * 60 * 60);
                    if (restHours >= 0 && restHours < MIN_REST_HOURS) {
                      if (!isValidEmendado(lastShiftName, shiftRef.name)) {
                        skippedAny = true;
                        continue;
                      }
                    }
                  }
                }
              }

              activeDates.add(date);
              if (!skippedAny && pi === extraPositionIndex) {
                const extraShift = manhaShift || tardeShift;
                if (extraShift) {
                  entries.push({ employee_id: employee.id, shift_type_id: extraShift.id, date, is_day_off: 0, is_locked: 0, notes: null });
                  totalHours += extraShift.duration_hours;
                  lastShiftEnd = computeShiftEnd(date, extraShift);
                  lastShiftName = extraShift.name;
                  consecutiveHours = extraShift.duration_hours;
                }
              } else {
                const shift = selectShift(twelveHourShifts, null, lastShiftEnd, lastShiftName, consecutiveHours, date);
                if (shift) {
                  entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0, notes: null });
                  totalHours += shift.duration_hours;
                  const shiftStart = computeShiftStart(date, shift);
                  const restHours = lastShiftEnd
                    ? (shiftStart - lastShiftEnd) / (1000 * 60 * 60)
                    : Infinity;
                  consecutiveHours = restHours === 0
                    ? consecutiveHours + shift.duration_hours
                    : shift.duration_hours;
                  lastShiftEnd = computeShiftEnd(date, shift);
                  lastShiftName = shift.name;
                } else {
                  skippedAny = true;
                  continue;
                }
              }
            }
          }

          for (const date of freeInWeek) {
            if (!activeDates.has(date)) {
              entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
              consecutiveHours = 0;
              lastShiftName = null;
            }
          }

        } else {

        // Garante mínimo 1 folga/semana quando não há férias ou forced-off (Regra: máx 6 dias consecutivos)
        const existingOffInWeek = vacInWeek.length + forcedOff.length;
        const minOffNeeded = freeInWeek.length > 0 ? Math.max(0, 1 - existingOffInWeek) : 0;
        const actualWorkInWeek = Math.min(freeInWeek.length - minOffNeeded, 3);
        const actualOffInWeek = freeInWeek.length - actualWorkInWeek;

        const selectedOff = selectOffDays(freeInWeek, actualOffInWeek, employee.id);
        const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

        // Bug #87: para motoristas com turno preferido EXPLICITAMENTE configurado como não-NOTURNO
        // (ex: DIURNO), não fazer fallback para NOTURNO quando o turno preferido é bloqueado.
        // DIURNO bloqueado → folga, não NOTURNO. Evita células DIURNO+NOTURNO adjacentes na UI.
        // NOTURNO, sem-preferência (preferred_shift_id=null) e padrão: usam todos os 12h.
        const shiftsForSelect = (rules.preferred_shift_id && !isNoturno) ? [preferredShift] : twelveHourShifts;

        for (const date of selectedWork) {
          const shift = selectShift(shiftsForSelect, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
          if (shift) {
            entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0, notes: null });
            totalHours += shift.duration_hours;

            const shiftStart = computeShiftStart(date, shift);
            const restHours = lastShiftEnd
              ? (shiftStart - lastShiftEnd) / (1000 * 60 * 60)
              : Infinity;

            consecutiveHours = restHours === 0
              ? consecutiveHours + shift.duration_hours
              : shift.duration_hours;

            lastShiftEnd = computeShiftEnd(date, shift);
            lastShiftName = shift.name;
          } else {
            entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
            consecutiveHours = 0;
            lastShiftName = null;
          }
        }

        // Recuperação NOTURNO: se selectedWork bloqueou turnos por restrição de descanso (12h < 24h),
        // tenta dias de selectedOff que tenham descanso adequado para completar a meta semanal.
        // Aplicado a todos os não-ADM: garante que semanas 42h recebam 3 plantões (não apenas 2)
        // quando selectOffDays seleciona dias consecutivos bloqueados. Issue #86 (NOTURNO), #90 (DIURNO).
        // NOTURNO e DIURNO têm o mesmo problema: turno termina às 07:00/19:00 e o próximo começa
        // 12h depois — rest < 24h mínimo → bloqueado. Recovery busca dia de selectedOff com rest ≥ 24h.
        if (!isAdm) {
          const placedThisWeek = entries.filter(
            (e) => !e.is_day_off && e.shift_type_id && e.date >= week[0] && e.date <= week[week.length - 1]
          ).length;
          if (placedThisWeek < actualWorkInWeek) {
            const needed = actualWorkInWeek - placedThisWeek;
            let recovered = 0;
            const convertedFromOff = new Set();
            for (const date of selectedOff) {
              if (recovered >= needed) break;
              if (lockedDates.has(date) || vacationDatesForEmp.has(date)) continue;

              // Fix #94: quando o lastShiftEnd global está no futuro em relação ao candidato
              // (caso cross-semana: isDiurno42h colocou turno no fim da semana anterior,
              // fazendo lastShiftEnd apontar para além do candidato de selectedOff),
              // usa virtual lastShiftEnd = último turno cronologicamente ANTES deste candidato.
              // Guarda crítica: se não houver preceding (candidato vem antes de todo trabalho
              // já feito, i.e., data retroativa), manter lastShiftEnd global — o rest negativo
              // fará o selectShift rejeitar corretamente, evitando colocação retroativa.
              let effectiveLastShiftEnd = lastShiftEnd;
              let effectiveLastShiftName = lastShiftName;
              let effectiveConsecutiveHours = consecutiveHours;

              if (lastShiftEnd) {
                const candidateShiftForCheck = shiftsForSelect[0] || preferredShift;
                if (candidateShiftForCheck) {
                  const candidateStart = computeShiftStart(date, candidateShiftForCheck);
                  if (candidateStart && lastShiftEnd > candidateStart) {
                    // O lastShiftEnd global está além do candidateStart: cross-semana isDiurno42h.
                    // Calcular virtual rest a partir do último turno ANTERIOR a este candidato.
                    const precedingWork = entries
                      .filter(e => !e.is_day_off && e.shift_type_id && e.date < date)
                      .sort((a, b) => (a.date > b.date ? 1 : -1));
                    const preceding = precedingWork.length ? precedingWork[precedingWork.length - 1] : null;
                    if (preceding) {
                      // preceding existe: usar virtual rest (o caso correto do fix #94)
                      effectiveLastShiftEnd = computeShiftEnd(preceding.date, shiftMap[preceding.shift_type_id]);
                      effectiveLastShiftName = shiftMap[preceding.shift_type_id]?.name ?? null;
                      effectiveConsecutiveHours = shiftMap[preceding.shift_type_id]?.duration_hours ?? 0;
                    }
                    // Se preceding === null: manter effectiveLastShiftEnd = lastShiftEnd global.
                    // selectShift verá rest < 0 e rejeitará → candidato retroativo pulado corretamente.
                  }
                }
              }

              const shift = selectShift(shiftsForSelect, preferredShift, effectiveLastShiftEnd, effectiveLastShiftName, effectiveConsecutiveHours, date);
              if (!shift) continue;
              // Verificar restrição de descanso PARA FRENTE (turno seguinte já colocado).
              // Necessário quando o virtual rest colocou este candidato em data anterior
              // a turnos já existentes no array entries — hasAdequateRest verifica ambos lados.
              const tempEntry = { date, is_day_off: 0, shift_type_id: shift.id, is_locked: 0 };
              if (!hasAdequateRest(entries, tempEntry, shift, shiftMap)) continue;
              if (wouldExceedConsecutive(entries, tempEntry)) continue;
              entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0, notes: null });
              totalHours += shift.duration_hours;
              const shiftStart = computeShiftStart(date, shift);
              const restHours = effectiveLastShiftEnd
                ? (shiftStart - effectiveLastShiftEnd) / (1000 * 60 * 60)
                : Infinity;
              consecutiveHours = restHours === 0
                ? consecutiveHours + shift.duration_hours
                : shift.duration_hours;
              lastShiftEnd = computeShiftEnd(date, shift);
              lastShiftName = shift.name;
              convertedFromOff.add(date);
              recovered++;
            }
            // Remove dias convertidos de selectedOff para não serem adicionados como folga abaixo
            for (const date of convertedFromOff) {
              const idx = selectedOff.indexOf(date);
              if (idx !== -1) selectedOff.splice(idx, 1);
            }
          }
        }

        for (const date of selectedOff) {
          entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0, notes: null });
          consecutiveHours = 0;
          lastShiftName = null;
        }


        // Issue #65: NOTURNO em semana 42h recebe 1 turno extra de 6h (Manhã ou Tarde).
        // Fix #119: null-preferred workers também usam este path (twelveHourShifts + emendado).
        // DIURNO 42h usa caminho separado acima (isDiurno42h).
        if ((isNoturno || rules.preferred_shift_id === null) && weekType === '42h') {
          const extraCandidates = [manhaShift, tardeShift].filter(Boolean);
          let extraAdded = false;

          for (const offDate of selectedOff) {
            if (extraAdded) break;
            if (lockedDates.has(offDate) || vacationDatesForEmp.has(offDate)) continue;

            for (const extraShift of extraCandidates) {
              if (!canAddExtraShiftInMemory(entries, offDate, extraShift, shiftMap)) continue;

              // Modifica a entrada de folga existente para turno de trabalho
              const offEntry = entries.find(
                (e) => e.date === offDate && e.is_day_off === 1 && !e.is_locked
              );
              if (!offEntry) continue;

              offEntry.is_day_off = 0;
              offEntry.shift_type_id = extraShift.id;
              offEntry.notes = null;
              totalHours += extraShift.duration_hours;
              extraAdded = true;
              break;
            }
          }
        }
        } // end else (generic path)
      }

      // Fix #104: normalizar lastShiftEnd/lastShiftName após cada semana.
      // A recovery loop pode sobrescrever lastShiftEnd com um turno anterior ao último
      // trabalho real (ex: recupera Apr21 depois de Apr25 já ter sido colocado por selectedWork),
      // fazendo a próxima semana calcular rest em relação a uma data mais antiga e permitir
      // violações de MIN_REST_HOURS (ex: Apr25 Diurno 19:00 → Apr26 Manhã 07:00 = 12h).
      {
        const latestWork = entries
          .filter(e => !e.is_day_off && e.shift_type_id)
          .reduce((latest, e) => (!latest || e.date > latest.date) ? e : latest, null);
        if (latestWork) {
          const latestShift = shiftMap[latestWork.shift_type_id];
          if (latestShift) {
            lastShiftEnd = computeShiftEnd(latestWork.date, latestShift);
            lastShiftName = latestShift.name;
          }
        }
      }
    }
  }

  // Correction step — preserva lockedOffDates (férias) e respeita limite semanal CLT
  // Passa isAdm explicitamente para que correctHours use o limite certo (turnos vs horas)
  // mesmo quando o turno 'Administrativo' não existe no DB.
  // Fix #127: passa cycleStartYear + cycleStartMonth (novo formato) para correctHours
  // usar índice global em vez de effectiveCycleMonth (legado, propenso a drift).
  const corrected = correctHours(
    entries, shiftTypes, shiftMap, totalHours, TARGET_HOURS,
    preferredShift, lockedOffDates, weeks,
    employee.cycle_start_year ?? genYear, isAdm,
    employee.cycle_start_month ?? 1
  );

  // Persist
  const insertEntry = db.prepare(
    `INSERT OR REPLACE INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const entry of corrected) {
    insertEntry.run(entry.employee_id, entry.shift_type_id, entry.date, entry.is_day_off, entry.is_locked, entry.notes ?? null);
  }

  const finalHours = corrected.reduce((sum, e) => {
    if (!e.is_day_off && e.shift_type_id) return sum + (shiftMap[e.shift_type_id]?.duration_hours || 0);
    return sum;
  }, 0);

  const deviation = finalHours - TARGET_HOURS;
  if (Math.abs(deviation) > 12) {
    warnings.push({
      employee: employee.name,
      hours: finalHours,
      deviation,
      message: `${employee.name}: ${finalHours}h (desvio de ${deviation > 0 ? '+' : ''}${deviation}h do alvo de 160h)`,
    });
  }

  // Issue #96: semanas parciais recebem label 'partial', semanas CLT usam índice global.
  // Fix #127: usa getWeekTypeGlobal para evitar drift em meses com 5 semanas.
  const weekClassifications = weeks.map((week, wi) => {
    const cltWi = wi - cltWeekOffset;
    return {
      weekIndex: wi,
      type: cltWi >= 0
        ? getWeekTypeGlobal(
            employee.cycle_start_year ?? genYear,
            employee.cycle_start_month ?? 1,
            week[0]
          )
        : 'partial',
      partial: week.length < 7,
    };
  });

  return { employee: employee.name, hours: finalHours, weekClassifications };
}

/**
 * Seleciona o turno mais adequado para o dia, respeitando:
 * - Prefere o turno preferido pelo setor
 * - Emendados válidos: Manhã→Tarde, Tarde→Noturno, Noturno→Manhã (regras 4 e 11)
 * - Bloqueia emendado se consecutiveHours + próximo turno >= 24h
 * - Descanso mínimo fixo de 24h (regra 10)
 */
function selectShift(shiftTypes, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date) {
  const sorted = [...shiftTypes].sort((a, b) => {
    const preferA = a.duration_hours === DEFAULT_SHIFT_HOURS ? 0 : 1;
    const preferB = b.duration_hours === DEFAULT_SHIFT_HOURS ? 0 : 1;
    return preferA - preferB;
  });

  const candidates = preferredShift
    ? [preferredShift, ...sorted.filter((s) => s.id !== preferredShift.id)]
    : sorted;

  for (const shift of candidates) {
    if (!lastShiftEnd) return shift; // Primeiro turno: sem restrições

    const shiftStart = computeShiftStart(date, shift);
    const restHours = (shiftStart - lastShiftEnd) / (1000 * 60 * 60);

    if (restHours === 0) {
      if (!isValidEmendado(lastShiftName, shift.name)) continue;
      if (consecutiveHours + shift.duration_hours > MAX_CONSECUTIVE_HOURS) continue;
      return shift;
    }

    if (restHours < 0) continue; // Turno já passou

    if (restHours < MIN_REST_HOURS) continue;

    return shift;
  }

  return null;
}

/**
 * Checks if an employee can work a given shift on a given date
 * without violating the 24h minimum rest rule or emendado restrictions.
 * Returns true if safe to assign, false otherwise.
 */
function canAssignShift(db, employeeId, date, shift) {
  // Find the previous work entry before this date
  const prevEntry = db.prepare(
    `SELECT se.is_day_off, se.date as prev_date,
            st.name as shift_name, st.start_time, st.duration_hours
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ? AND se.date < ? AND se.is_day_off = 0
     ORDER BY se.date DESC LIMIT 1`
  ).get(employeeId, date);

  if (prevEntry && prevEntry.start_time && prevEntry.duration_hours) {
    const prevEnd = computeShiftEnd(prevEntry.prev_date, prevEntry);
    const newStart = computeShiftStart(date, shift);
    if (prevEnd && newStart) {
      const restHours = (newStart - prevEnd) / (1000 * 60 * 60);
      if (restHours === 0) {
        if (!isValidEmendado(prevEntry.shift_name, shift.name)) return false;
        // Reject if combined hours would exceed MAX_CONSECUTIVE_HOURS
        if ((prevEntry.duration_hours || 0) + shift.duration_hours > MAX_CONSECUTIVE_HOURS) return false;
      } else if (restHours < 0) {
        return false;
      } else if (restHours < MIN_REST_HOURS) {
        return false;
      }
    }
  }

  // Also check next work entry after this date (to avoid pushing into < 24h rest)
  const nextEntry = db.prepare(
    `SELECT se.is_day_off, se.date as next_date,
            st.name as shift_name, st.start_time, st.duration_hours
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ? AND se.date > ? AND se.is_day_off = 0
     ORDER BY se.date ASC LIMIT 1`
  ).get(employeeId, date);

  if (nextEntry && nextEntry.start_time && nextEntry.duration_hours) {
    const newEnd = computeShiftEnd(date, shift);
    const nextStart = computeShiftStart(nextEntry.next_date, nextEntry);
    if (newEnd && nextStart) {
      const restHours = (nextStart - newEnd) / (1000 * 60 * 60);
      if (restHours === 0) {
        if (!isValidEmendado(shift.name, nextEntry.shift_name)) return false;
        // Reject if combined hours would exceed MAX_CONSECUTIVE_HOURS
        if (shift.duration_hours + (nextEntry.duration_hours || 0) > MAX_CONSECUTIVE_HOURS) return false;
      } else if (restHours < 0) {
        return false;
      } else if (restHours < MIN_REST_HOURS) {
        return false;
      }
    }
  }

  return true;
}

/**
 * In-memory equivalent of canAssignShift — checks rest rules against the
 * already-built entries array (before DB persistence).
 * Used to validate the extra 6h shift in 42h weeks (issue #65).
 */
function canAddExtraShiftInMemory(entries, date, shift, shiftMap) {
  const workEntries = entries
    .filter((e) => !e.is_day_off && e.shift_type_id)
    .sort((a, b) => a.date.localeCompare(b.date));

  const prev = [...workEntries].reverse().find((e) => e.date < date);
  if (prev) {
    const prevShift = shiftMap[prev.shift_type_id];
    if (prevShift) {
      const prevEnd  = computeShiftEnd(prev.date, prevShift);
      const newStart = computeShiftStart(date, shift);
      if (prevEnd && newStart) {
        const restHours = (newStart - prevEnd) / 3_600_000;
        if (restHours === 0) {
          if (!isValidEmendado(prevShift.name, shift.name)) return false;
          if (prevShift.duration_hours + shift.duration_hours > MAX_CONSECUTIVE_HOURS) return false;
        } else if (restHours < 0 || restHours < MIN_REST_HOURS) {
          return false;
        }
      }
    }
  }

  const next = workEntries.find((e) => e.date > date);
  if (next) {
    const nextShift = shiftMap[next.shift_type_id];
    if (nextShift) {
      const newEnd    = computeShiftEnd(date, shift);
      const nextStart = computeShiftStart(next.date, nextShift);
      if (newEnd && nextStart) {
        const restHours = (nextStart - newEnd) / 3_600_000;
        if (restHours === 0) {
          if (!isValidEmendado(shift.name, nextShift.name)) return false;
          if (shift.duration_hours + nextShift.duration_hours > MAX_CONSECUTIVE_HOURS) return false;
        } else if (restHours < 0 || restHours < MIN_REST_HOURS) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Employees already at/above this hours threshold are not eligible for
 * coverage enforcement conversions — they already met their monthly target.
 */
const COVERAGE_HOURS_CAP = TARGET_HOURS;

/**
 * Returns the current total worked hours for an employee in the month dates range.
 */
function getEmployeeHours(db, employeeId, startDate, endDate) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(st.duration_hours), 0) as total
     FROM schedule_entries se
     LEFT JOIN shift_types st ON se.shift_type_id = st.id
     WHERE se.employee_id = ? AND se.date >= ? AND se.date <= ? AND se.is_day_off = 0`
  ).get(employeeId, startDate, endDate);
  return row?.total ?? 0;
}

/**
 * Rule 16: Cobertura diurna Seg–Sab.
 * ≥2 motoristas de Hemodiálise e ≥1 de Ambulância no turno Diurno.
 * Converte folgas (não bloqueadas) dos motoristas elegíveis se necessário,
 * respeitando o limite semanal CLT de cada motorista.
 */
function enforceDiurnoCoverage(db, employees, employeeSectorsMap, dates, diurnoShift, warnings) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  // Deriva mês/ano de geração a partir da primeira data do período
  const genYear  = parseInt(startDate.slice(0, 4));
  const genMonth = parseInt(startDate.slice(5, 7));

  // Agrupa datas em semanas (Dom–Sáb) para verificação do limite semanal CLT
  const weeks = buildWeeks(dates);

  // Issue #103: detectar semana parcial inicial (mesmo critério de generateForEmployee).
  // Se o mês não começa num domingo, a semana 0 é parcial e não conta como semana CLT.
  // cltWeekOffset=1 desloca o índice CLT para que a semana 1 (primeira completa) seja wi_clt=0.
  const firstWeekIsPartial = weeks.length > 0 && weeks[0].length < 7;
  const cltWeekOffset = firstWeekIsPartial ? 1 : 0;

  /**
   * Retorna o início e fim da semana à qual `date` pertence.
   */
  function getWeekBounds(date) {
    const week = weeks.find((w) => w.includes(date));
    if (!week) return null;
    return { weekStart: week[0], weekEnd: week[week.length - 1], weekIndex: weeks.indexOf(week) };
  }

  /**
   * Verifica se converter o candidato `emp` na data `date` para o turno `shift`
   * ultrapassaria o limite semanal CLT do motorista.
   * Retorna true se for SEGURO converter (limite não excedido); false caso contrário.
   */
  function withinWeeklyLimit(emp, date, shift) {
    const bounds = getWeekBounds(date);
    if (!bounds) return true; // sem contexto de semana — permite por segurança

    const setores = employeeSectorsMap[emp.id] || [];
    const isAdm = setores.includes(SETOR_ADM);
    // Para motoristas não-ADM, Diurno não tem turno extra → isNoturno = false
    const isNoturno = false;

    // Fix #127: usar índice global baseado no cycle_start do funcionário.
    // Issue #103: aplicar cltWeekOffset para alinhar índice de semana com o gerador.
    // Semanas parciais (cltWi < 0) usam '36h' como fallback — sem meta CLT.
    const cltWi = bounds.weekIndex - cltWeekOffset;
    const weekType = cltWi >= 0
      ? getWeekTypeGlobal(
          emp.cycle_start_year ?? genYear,
          emp.cycle_start_month ?? 1,
          bounds.weekStart
        )
      : '36h';
    const cltLimit = getWeekLimitHours(isAdm, isNoturno, weekType);

    if (cltLimit.type === 'shifts') {
      const currentShifts = getWeeklyShiftCount(db, emp.id, bounds.weekStart, bounds.weekEnd);
      return currentShifts < cltLimit.limit;
    }
    // type === 'hours'
    const currentWeekHours = getWeeklyHours(db, emp.id, bounds.weekStart, bounds.weekEnd);
    return (currentWeekHours + shift.duration_hours) <= cltLimit.limit;
  }

  for (const date of dates) {
    const dow = new Date(date + 'T12:00:00').getDay();
    if (dow === 0) continue; // skip Sunday

    const entries = db.prepare(
      `SELECT se.employee_id, se.id, se.is_day_off, se.is_locked, se.shift_type_id, se.notes,
              st.name as shift_name
       FROM schedule_entries se
       LEFT JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date = ?`
    ).all(date);

    const entryByEmp = {};
    for (const e of entries) entryByEmp[e.employee_id] = e;

    let hemoCount = 0;
    let ambulCount = 0;
    for (const emp of employees) {
      const setores = employeeSectorsMap[emp.id] || [];
      const entry = entryByEmp[emp.id];
      if (!entry || entry.is_day_off) continue;
      if (entry.shift_name === SHIFT_DIURNO_NAME) {
        if (setores.includes(SETOR_HEMO)) hemoCount++;
        if (setores.includes(SETOR_AMBUL)) ambulCount++;
      }
    }

    // Fix Hemo coverage (need ≥2)
    if (hemoCount < 2) {
      let fixed = 0;
      const needed = 2 - hemoCount;
      for (const emp of employees) {
        if (fixed >= needed) break;
        const setores = employeeSectorsMap[emp.id] || [];
        if (!setores.includes(SETOR_HEMO)) continue;
        // Regra 12: seg_sex nunca trabalha Sábado (dow=6); domingo já é excluído acima.
        if (emp.work_schedule === 'seg_sex' && dow === 6) continue;
        const entry = entryByEmp[emp.id];
        if (!entry || !entry.is_day_off || entry.is_locked || entry.notes === 'Férias') continue;
        if (!canAssignShift(db, emp.id, date, diurnoShift)) continue;
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
        if (!withinWeeklyLimit(emp, date, diurnoShift)) continue;
        db.prepare(
          'UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?'
        ).run(diurnoShift.id, entry.id);
        entry.is_day_off = 0;
        entry.shift_name = SHIFT_DIURNO_NAME;
        entry.shift_type_id = diurnoShift.id;
        fixed++;
      }
      if (hemoCount + fixed < 2) {
        warnings.push({
          type: 'diurno_hemo',
          date,
          count: hemoCount + fixed,
          required: 2,
          message: `${date}: cobertura insuficiente Hemodiálise turno Diurno (${hemoCount + fixed}/2)`,
        });
      }
    }

    // Recalculate ambulCount after potential Hemo conversions — a multi-sector
    // (Hemo+Ambul) employee converted above would otherwise be counted twice.
    ambulCount = 0;
    for (const emp of employees) {
      const setores = employeeSectorsMap[emp.id] || [];
      if (!setores.includes(SETOR_AMBUL)) continue;
      const entry = entryByEmp[emp.id];
      if (!entry || entry.is_day_off) continue;
      if (entry.shift_name === SHIFT_DIURNO_NAME) ambulCount++;
    }

    // Fix Ambul coverage (need ≥1)
    if (ambulCount < 1) {
      let fixed = false;
      for (const emp of employees) {
        if (fixed) break;
        const setores = employeeSectorsMap[emp.id] || [];
        if (!setores.includes(SETOR_AMBUL)) continue;
        // Regra 12: seg_sex nunca trabalha Sábado (dow=6); domingo já é excluído acima.
        if (emp.work_schedule === 'seg_sex' && dow === 6) continue;
        const entry = entryByEmp[emp.id];
        if (!entry || !entry.is_day_off || entry.is_locked || entry.notes === 'Férias') continue;
        if (!canAssignShift(db, emp.id, date, diurnoShift)) continue;
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
        if (!withinWeeklyLimit(emp, date, diurnoShift)) continue;
        db.prepare(
          'UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?'
        ).run(diurnoShift.id, entry.id);
        entry.is_day_off = 0;
        entry.shift_name = SHIFT_DIURNO_NAME;
        entry.shift_type_id = diurnoShift.id;
        fixed = true;
      }
      if (!fixed) {
        warnings.push({
          type: 'diurno_ambul',
          date,
          count: ambulCount,
          required: 1,
          message: `${date}: cobertura insuficiente Ambulância turno Diurno (${ambulCount}/1)`,
        });
      }
    }
  }
}

/**
 * Rules 21 & 22: Cobertura noturna por dia da semana.
 * Ter/Qui/Sab (dow 2,4,6): ≥2 motoristas Ambulância no Noturno.
 * Seg/Qua/Sex (dow 1,3,5): ≥1 motorista Ambulância no Noturno.
 * Respeita o limite semanal CLT de cada motorista.
 */
function enforceNocturnalCoverage(db, employees, employeeSectorsMap, dates, noturnoShift, warnings) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  // Deriva mês/ano de geração a partir da primeira data do período
  const genYear  = parseInt(startDate.slice(0, 4));
  const genMonth = parseInt(startDate.slice(5, 7));

  // Agrupa datas em semanas (Dom–Sáb) para verificação do limite semanal CLT
  const weeks = buildWeeks(dates);

  // Issue #103: detectar semana parcial inicial (mesmo critério de generateForEmployee).
  const firstWeekIsPartial = weeks.length > 0 && weeks[0].length < 7;
  const cltWeekOffset = firstWeekIsPartial ? 1 : 0;

  // Cache do turno preferido por employee_id — usado para não forçar NOTURNO em motoristas DIURNO.
  // Bug #87: enforceNocturnalCoverage não verificava preferred_shift antes de converter.
  const preferredShiftNameByEmp = {};
  for (const emp of employees) {
    const row = db
      .prepare(
        `SELECT st.name as shift_name
         FROM employee_rest_rules err
         LEFT JOIN shift_types st ON err.preferred_shift_id = st.id
         WHERE err.employee_id = ?`
      )
      .get(emp.id);
    preferredShiftNameByEmp[emp.id] = row?.shift_name ?? null;
  }

  /**
   * Retorna os limites da semana à qual `date` pertence.
   */
  function getWeekBounds(date) {
    const week = weeks.find((w) => w.includes(date));
    if (!week) return null;
    return { weekStart: week[0], weekEnd: week[week.length - 1], weekIndex: weeks.indexOf(week) };
  }

  /**
   * Verifica se converter o candidato `emp` na data `date` para o turno `shift`
   * ultrapassaria o limite semanal CLT do motorista.
   * Para noturno enforcement: o motorista tem turno noturno, isNoturno=true.
   */
  function withinWeeklyLimit(emp, date, shift) {
    const bounds = getWeekBounds(date);
    if (!bounds) return true;

    const setores = employeeSectorsMap[emp.id] || [];
    const isAdm = setores.includes(SETOR_ADM);
    // O enforcement noturno converte para turno Noturno → isNoturno = true para não-ADM
    const isNoturno = !isAdm;

    // Fix #127: usar índice global baseado no cycle_start do funcionário.
    // Issue #103: aplicar cltWeekOffset para alinhar índice de semana com o gerador.
    const cltWi = bounds.weekIndex - cltWeekOffset;
    const weekType = cltWi >= 0
      ? getWeekTypeGlobal(
          emp.cycle_start_year ?? genYear,
          emp.cycle_start_month ?? 1,
          bounds.weekStart
        )
      : '36h';
    const cltLimit = getWeekLimitHours(isAdm, isNoturno, weekType);

    if (cltLimit.type === 'shifts') {
      const currentShifts = getWeeklyShiftCount(db, emp.id, bounds.weekStart, bounds.weekEnd);
      return currentShifts < cltLimit.limit;
    }
    // type === 'hours'
    const currentWeekHours = getWeeklyHours(db, emp.id, bounds.weekStart, bounds.weekEnd);
    return (currentWeekHours + shift.duration_hours) <= cltLimit.limit;
  }

  for (const date of dates) {
    const dow = new Date(date + 'T12:00:00').getDay();
    const required = [2, 4, 6].includes(dow) ? 2 : [1, 3, 5].includes(dow) ? 1 : 0;
    if (required === 0) continue;

    const entries = db.prepare(
      `SELECT se.employee_id, se.id, se.is_day_off, se.is_locked, se.notes,
              st.name as shift_name
       FROM schedule_entries se
       LEFT JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date = ?`
    ).all(date);

    const entryByEmp = {};
    for (const e of entries) entryByEmp[e.employee_id] = e;

    let ambulNoturno = 0;
    for (const emp of employees) {
      const setores = employeeSectorsMap[emp.id] || [];
      if (!setores.includes(SETOR_AMBUL)) continue;
      const entry = entryByEmp[emp.id];
      if (!entry || entry.is_day_off) continue;
      if (entry.shift_name === SHIFT_NOTURNO_NAME) ambulNoturno++;
    }

    if (ambulNoturno < required) {
      let fixed = 0;
      const needed = required - ambulNoturno;
      for (const emp of employees) {
        if (fixed >= needed) break;
        const setores = employeeSectorsMap[emp.id] || [];
        if (!setores.includes(SETOR_AMBUL)) continue;
        // Bug #87: só converte motoristas cujo turno preferido é NOTURNO (ou sem preferência).
        // Motoristas DIURNO não devem ser forçados a NOTURNO — viola o turno contratado.
        const prefName = preferredShiftNameByEmp[emp.id];
        if (prefName && prefName !== SHIFT_NOTURNO_NAME) continue;
        // Regra 12: seg_sex nunca trabalha Sábado (dow=6); domingo já tem required=0 acima.
        if (emp.work_schedule === 'seg_sex' && dow === 6) continue;
        const entry = entryByEmp[emp.id];
        if (!entry || !entry.is_day_off || entry.is_locked || entry.notes === 'Férias') continue;
        if (!canAssignShift(db, emp.id, date, noturnoShift)) continue;
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
        if (!withinWeeklyLimit(emp, date, noturnoShift)) continue;
        db.prepare(
          'UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?'
        ).run(noturnoShift.id, entry.id);
        entry.is_day_off = 0;
        entry.shift_name = SHIFT_NOTURNO_NAME;
        entry.shift_type_id = noturnoShift.id;
        fixed++;
      }
      if (ambulNoturno + fixed < required) {
        warnings.push({
          type: 'noturno_ambul',
          date,
          count: ambulNoturno + fixed,
          required,
          message: `${date}: cobertura insuficiente Ambulância turno Noturno (${ambulNoturno + fixed}/${required})`,
        });
      }
    }
  }
}

/**
 * Rule 19/42 (enforcement): Garante cobertura mínima de MIN_DAILY_COVERAGE motoristas por dia.
 * @exported para testes unitários
 * Loop por iteração até filled === MIN_DAILY_COVERAGE, re-buscando folgas a cada volta.
 * Passo 1: converte folga respeitando restrições de descanso, work_schedule=seg_sex e limite CLT semanal.
 * Passo 2 (fallback): ignora MIN_REST_HOURS e consecutivos; ainda respeita seg_sex e limite CLT semanal.
 *   Emite sem_motorista_forcado (1º) ou segundo_motorista_forcado (2º+).
 * Passo 3 (emergência): força até candidatos seg_sex em Sáb/Dom quando não há outro.
 *   Ainda respeita limite CLT semanal. Emite warning sem_motorista_forcado_seg_sex para rastreabilidade.
 * Passo 4 (último recurso): ignora limite CLT semanal — usado quando todos workers atingiram o limite
 *   CLT semanal antes do fim da semana. Seleciona candidato com menor carga mensal para minimizar
 *   sobrecarga. Emite clt_weekly_overflow para rastreabilidade.
 * Emite sem_motorista (filled=0) ou cobertura_minima_insuficiente (filled>0 mas <MIN)
 *   quando não há candidatos disponíveis.
 */
export function enforceDailyCoverage(db, employees, employeeSectorsMap, shiftTypes, dates, warnings) {
  const defaultShift =
    shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) || shiftTypes[0];

  const startDate = dates[0];
  const endDate   = dates[dates.length - 1];

  // Deriva mês/ano de geração a partir da primeira data do período
  const genYear  = parseInt(startDate.slice(0, 4));
  const genMonth = parseInt(startDate.slice(5, 7));

  // Agrupa datas em semanas (Dom–Sáb) para verificação do limite semanal CLT
  const weeks = buildWeeks(dates);

  // Issue #103: detectar semana parcial inicial (mesmo critério de generateForEmployee).
  // Se o mês não começa num domingo, a semana 0 é parcial e não conta como semana CLT.
  // cltWeekOffset=1 desloca o índice CLT para que a semana 1 (primeira completa) seja wi_clt=0.
  const firstWeekIsPartial = weeks.length > 0 && weeks[0].length < 7;
  const cltWeekOffset = firstWeekIsPartial ? 1 : 0;

  // Cache preferred shift por employee_id (definido antes de withinWeeklyLimit que o referencia)
  const preferredShiftCache = {};
  const getShiftForEmp = (emp) => {
    if (preferredShiftCache[emp.id] !== undefined) return preferredShiftCache[emp.id];
    const rules = db
      .prepare('SELECT preferred_shift_id FROM employee_rest_rules WHERE employee_id = ?')
      .get(emp.id);
    if (rules?.preferred_shift_id) {
      const s = shiftTypes.find((sh) => sh.id === rules.preferred_shift_id);
      if (s) { preferredShiftCache[emp.id] = s; return s; }
    }
    const isAdm = (employeeSectorsMap[emp.id] || []).includes(SETOR_ADM);
    // Fix #119: null-preferred non-ADM workers use Noturno fallback in enforcement,
    // consistent with the generator's twelveHourShifts path. Prevents Noturno→Diurno(0h rest).
    const noturnoFallback = shiftTypes.find((s) => s.name === SHIFT_NOTURNO_NAME);
    const fallback = isAdm
      ? (shiftTypes.find((s) => s.name === SHIFT_ADM_NAME) || defaultShift)
      : (noturnoFallback || defaultShift);
    preferredShiftCache[emp.id] = fallback;
    return fallback;
  };

  /**
   * Retorna os limites da semana à qual `date` pertence.
   */
  function getWeekBounds(date) {
    const week = weeks.find((w) => w.includes(date));
    if (!week) return null;
    return { weekStart: week[0], weekEnd: week[week.length - 1], weekIndex: weeks.indexOf(week) };
  }

  /**
   * Verifica se converter o candidato `emp` na data `date` para o turno `shift`
   * ultrapassaria o limite semanal CLT do motorista.
   * Retorna true se for SEGURO converter (limite não excedido); false caso contrário.
   */
  function withinWeeklyLimit(emp, date, shift) {
    const bounds = getWeekBounds(date);
    if (!bounds) return true;

    const setores = employeeSectorsMap[emp.id] || [];
    const isAdm = setores.includes(SETOR_ADM);
    // Usa o turno preferido para determinar isNoturno
    const empShift = getShiftForEmp(emp);
    const isNoturno = !isAdm && empShift?.name === SHIFT_NOTURNO_NAME;

    // Fix #127: usar índice global baseado no cycle_start do funcionário.
    // Issue #103: aplicar cltWeekOffset para alinhar índice de semana com o gerador.
    // Semanas parciais (cltWi < 0) usam '36h' como fallback — sem meta CLT.
    const cltWi = bounds.weekIndex - cltWeekOffset;
    const weekType = cltWi >= 0
      ? getWeekTypeGlobal(
          emp.cycle_start_year ?? genYear,
          emp.cycle_start_month ?? 1,
          bounds.weekStart
        )
      : '36h';
    const cltLimit = getWeekLimitHours(isAdm, isNoturno, weekType);

    if (cltLimit.type === 'shifts') {
      const currentShifts = getWeeklyShiftCount(db, emp.id, bounds.weekStart, bounds.weekEnd);
      return currentShifts < cltLimit.limit;
    }
    // type === 'hours'
    const currentWeekHours = getWeeklyHours(db, emp.id, bounds.weekStart, bounds.weekEnd);
    return (currentWeekHours + shift.duration_hours) <= cltLimit.limit;
  }

  for (const date of dates) {
    const initialCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM schedule_entries
         WHERE date = ? AND is_day_off = 0
           AND employee_id IN (SELECT id FROM employees WHERE active = 1)`
      )
      .get(date).c;
    if (initialCount >= MIN_DAILY_COVERAGE) continue;

    const dow = new Date(date + 'T12:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;

    let filled = initialCount;

    while (filled < MIN_DAILY_COVERAGE) {
      // Re-busca folgas a cada iteração — candidatos mudam após cada atribuição
      const folgas = db
        .prepare(
          `SELECT se.id, se.employee_id FROM schedule_entries se
           WHERE se.date = ? AND se.is_day_off = 1 AND se.is_locked = 0
             AND (se.notes IS NULL OR se.notes != 'Férias')
             AND se.employee_id IN (SELECT id FROM employees WHERE active = 1)`
        )
        .all(date);

      if (folgas.length === 0) {
        if (filled === 0) {
          warnings.push({ type: 'sem_motorista', date, message: `${date}: nenhum motorista escalado` });
        } else {
          warnings.push({
            type: 'cobertura_minima_insuficiente',
            date,
            message: `${date}: apenas ${filled}/${MIN_DAILY_COVERAGE} motoristas — sem candidatos disponíveis`,
          });
        }
        break;
      }

      // Ordena candidatos por mais dias desde o último trabalho (mais descansado primeiro)
      const candidates = folgas
        .map((f) => {
          const emp = employees.find((e) => e.id === f.employee_id);
          if (!emp) return null;
          const lastWork = db
            .prepare(
              `SELECT date FROM schedule_entries
               WHERE employee_id = ? AND date < ? AND is_day_off = 0
               ORDER BY date DESC LIMIT 1`
            )
            .get(emp.id, date);
          const daysSince = lastWork
            ? Math.round(
                (new Date(date + 'T12:00:00Z') - new Date(lastWork.date + 'T12:00:00Z')) /
                  86_400_000
              )
            : 999;
          return { folgaId: f.id, emp, daysSince };
        })
        .filter(Boolean)
        .sort((a, b) => b.daysSince - a.daysSince);

      const isSecond = filled > 0;

      // Passo 1: com restrições de descanso, cap de horas e limite CLT semanal (respeita seg_sex)
      let assigned = false;
      for (const { folgaId, emp } of candidates) {
        if (emp.work_schedule === 'seg_sex' && isWeekend) continue;
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
        const shift = getShiftForEmp(emp);
        if (!canAssignShift(db, emp.id, date, shift)) continue;
        if (!withinWeeklyLimit(emp, date, shift)) continue;
        db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
          .run(shift.id, folgaId);
        filled++;
        assigned = true;
        break;
      }
      if (assigned) continue;

      // Passo 2: forçado — ignora restrições de descanso, consecutivos e cap de horas; respeita seg_sex e limite CLT semanal
      // Cap removido: permite motoristas acima de 160h como último recurso (fix #103, PO confirmado).
      let forced = false;
      for (const { folgaId, emp } of candidates) {
        if (emp.work_schedule === 'seg_sex' && isWeekend) continue;
        const shift = getShiftForEmp(emp);
        if (!withinWeeklyLimit(emp, date, shift)) continue;
        db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
          .run(shift.id, folgaId);
        warnings.push({
          type: isSecond ? 'segundo_motorista_forcado' : 'sem_motorista_forcado',
          date,
          employee: emp.name,
          message: isSecond
            ? `${date}: segundo motorista forçado para ${emp.name} (cobertura mínima ${MIN_DAILY_COVERAGE}/dia)`
            : `${date}: cobertura diária forçada para ${emp.name} (restrições de descanso ignoradas)`,
        });
        filled++;
        forced = true;
        break;
      }
      if (forced) continue;

      // Passo 3 (emergência): força candidato seg_sex em Sáb/Dom — equipe insuficiente de dom_sab
      // Ainda respeita cap e limite CLT semanal (cap restaurado: evita seg_sex acima de 160h no Domingo).
      for (const { folgaId, emp } of candidates) {
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
        const shift = getShiftForEmp(emp);
        if (!withinWeeklyLimit(emp, date, shift)) continue;
        db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
          .run(shift.id, folgaId);
        warnings.push({
          type: 'sem_motorista_forcado_seg_sex',
          date,
          employee: emp.name,
          message: `${date}: cobertura de emergência para ${emp.name} (seg_sex forçado em fim de semana — equipe insuficiente)`,
        });
        filled++;
        forced = true;
        break;
      }
      // Passo 4 (último recurso): ignora limite CLT semanal — todos os passos anteriores falharam.
      // Ocorre quando todos os workers atingiram o limite CLT semanal antes do fim da semana.
      // Seleciona o candidato com menor carga mensal para minimizar sobrecarga.
      // Ainda respeita a restrição seg_sex em fins de semana — apenas dom_sab pode ser forçado aqui.
      if (!forced) {
        const byHours = [...candidates].sort(
          (a, b) =>
            getEmployeeHours(db, a.emp.id, startDate, endDate) -
            getEmployeeHours(db, b.emp.id, startDate, endDate)
        );
        for (const { folgaId, emp } of byHours) {
          if (emp.work_schedule === 'seg_sex' && isWeekend) continue;
          if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
          const shift = getShiftForEmp(emp);
          db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
            .run(shift.id, folgaId);
          warnings.push({
            type: 'clt_weekly_overflow',
            date,
            employee: emp.name,
            message: `${date}: cobertura forçada para ${emp.name} — limite CLT semanal excedido (último recurso)`,
          });
          filled++;
          forced = true;
          break;
        }
      }

      if (!forced) {
        if (filled === 0) {
          warnings.push({ type: 'sem_motorista', date, message: `${date}: nenhum motorista escalado` });
        } else {
          warnings.push({
            type: 'cobertura_minima_insuficiente',
            date,
            message: `${date}: apenas ${filled}/${MIN_DAILY_COVERAGE} motoristas — equipe insuficiente`,
          });
        }
        break;
      }
    }
  }
}

export function buildWeeks(dates) {
  const weeks = [];
  let currentWeek = [];

  for (const date of dates) {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    if (dayOfWeek === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(date);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return weeks;
}

function selectOffDays(freeDays, count, empOffset = 0) {
  if (count <= 0 || freeDays.length === 0) return [];
  const len = freeDays.length;
  const workCount = len - count;
  if (workCount <= 0) return [...freeDays];
  // Rotate the work window per employee so folgas are distributed across different days.
  // Without this, all employees share the same off days every week (issues #55).
  const workStart = empOffset % len;
  const workIndices = new Set();
  for (let i = 0; i < workCount; i++) {
    workIndices.add((workStart + i) % len);
  }
  return freeDays.filter((_, idx) => !workIndices.has(idx));
}

function computeShiftStart(date, shift) {
  if (!shift.start_time || !/^\d{1,2}:\d{2}$/.test(shift.start_time)) return null;
  const [h, m] = shift.start_time.split(':').map(Number);
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
}

function computeShiftEnd(date, shift) {
  const start = computeShiftStart(date, shift);
  if (!start) return null;
  return new Date(start.getTime() + shift.duration_hours * 60 * 60 * 1000);
}

/**
 * Verifica se converter `targetEntry` em turno de trabalho criaria uma sequência
 * de mais de MAX_CONSECUTIVE_WORK_DAYS dias consecutivos de trabalho.
 * Opera sobre datas de calendário (sem depender de start_time).
 * Retorna true se o limite seria excedido; false se é seguro converter.
 */
function wouldExceedConsecutive(allEntries, targetEntry) {
  const targetDate = targetEntry.date;
  const workDates = new Set(
    allEntries.filter(e => !e.is_day_off && e.shift_type_id).map(e => e.date)
  );

  // Conta dias consecutivos de trabalho imediatamente antes de targetDate
  let before = 0;
  let cursor = new Date(targetDate + 'T12:00:00Z');
  while (true) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    if (workDates.has(cursor.toISOString().slice(0, 10))) before++;
    else break;
  }

  // Conta dias consecutivos de trabalho imediatamente após targetDate
  let after = 0;
  cursor = new Date(targetDate + 'T12:00:00Z');
  while (true) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (workDates.has(cursor.toISOString().slice(0, 10))) after++;
    else break;
  }

  return (before + 1 + after) > MAX_CONSECUTIVE_WORK_DAYS;
}

/**
 * Verifica se inserir `shift` na data de `targetEntry` respeita ≥24h de descanso
 * em relação aos turnos adjacentes já existentes em `allEntries` (in-memory).
 * Retorna true se é seguro converter; false caso contrário.
 */
function hasAdequateRest(allEntries, targetEntry, shift, shiftMap) {
  const targetDate = targetEntry.date;

  const workEntries = allEntries
    .filter(e => !e.is_day_off && e.shift_type_id)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Turno anterior
  const prev = [...workEntries].reverse().find(e => e.date < targetDate);
  if (prev) {
    const prevShift = shiftMap[prev.shift_type_id];
    if (prevShift) {
      const prevEnd  = computeShiftEnd(prev.date, prevShift);
      const newStart = computeShiftStart(targetDate, shift);
      if (prevEnd && newStart) {
        const restMs = newStart - prevEnd;
        if (restMs === 0) {
          if (!isValidEmendado(prevShift.name, shift.name)) return false;
          if (prevShift.duration_hours + shift.duration_hours > MAX_CONSECUTIVE_HOURS) return false;
        } else if (restMs < 0 || restMs < MIN_REST_HOURS * 3_600_000) {
          return false;
        }
      }
    }
  }

  // Turno seguinte
  const next = workEntries.find(e => e.date > targetDate);
  if (next) {
    const nextShift = shiftMap[next.shift_type_id];
    if (nextShift) {
      const newEnd    = computeShiftEnd(targetDate, shift);
      const nextStart = computeShiftStart(next.date, nextShift);
      if (newEnd && nextStart) {
        const restMs = nextStart - newEnd;
        if (restMs === 0) {
          if (!isValidEmendado(shift.name, nextShift.name)) return false;
          if (shift.duration_hours + nextShift.duration_hours > MAX_CONSECUTIVE_HOURS) return false;
        } else if (restMs < 0 || restMs < MIN_REST_HOURS * 3_600_000) {
          return false;
        }
      }
    }
  }

  return true;
}

export function correctHours(
  entries, shiftTypes, shiftMap, currentHours, target,
  preferredShift = null, lockedOffDates = new Set(),
  weeks = [], cycleStartYearOrLegacy = null, isAdmOverride = null,
  cycleStartMonth = null
) {
  const diff = currentHours - target;
  if (Math.abs(diff) <= 6) return entries;

  // Suporte legado: cycleStartYearOrLegacy pode ser cycleStartYear (number ≥ 1900)
  // ou effectiveCycleMonth (1|2|3) para compatibilidade com testes unitários antigos.
  // Quando cycleStartMonth é fornecido, trata-se do novo formato (year + month).
  const isNewFormat = cycleStartMonth !== null;
  const cycleStartYear = isNewFormat ? cycleStartYearOrLegacy : null;
  const legacyEffectiveCycleMonth = isNewFormat ? null : cycleStartYearOrLegacy;

  // Determina se o motorista é ADM ou NOTURNO com base no turno preferido.
  // isAdmOverride é passado pelo chamador quando o turno preferido não está disponível
  // no DB (ex: shift 'Administrativo' não seedado) mas o setor do funcionário é ADM.
  const isAdm     = isAdmOverride ?? (preferredShift?.name === SHIFT_ADM_NAME);
  const isNoturno = preferredShift?.name === SHIFT_NOTURNO_NAME;

  // Monta mapa semana → {weekStart, weekEnd, weekIndex, weekType, cltLimit}
  // para verificação do limite CLT por semana em conversões de folga→trabalho.
  // Issue #96: semanas parciais (< 7 dias) usam '42h' como fallback conservador —
  // não remover entries de semanas parciais que estão naturalmente abaixo do limite.
  // Fix #127: usa getWeekTypeGlobal quando cycleStartYear + cycleStartMonth fornecidos;
  // senão cai para o cálculo legado (para compatibilidade com testes unitários).
  const firstWeekIsPartialCH = weeks.length > 0 && weeks[0].length < 7;
  const cltWeekOffsetCH = firstWeekIsPartialCH ? 1 : 0;
  const weekMeta = weeks.map((week, wi) => {
    const cltWiCH = wi - cltWeekOffsetCH;
    let weekType;
    if (isNewFormat && cltWiCH >= 0) {
      weekType = getWeekTypeGlobal(cycleStartYear, cycleStartMonth, week[0]);
    } else if (!isNewFormat && legacyEffectiveCycleMonth !== null && cltWiCH >= 0) {
      weekType = getWeekTypeFromPhase(legacyEffectiveCycleMonth, cltWiCH);
    } else {
      weekType = '42h'; // fallback conservador: semanas parciais ou sem contexto de fase
    }
    return {
      weekStart: week[0],
      weekEnd: week[week.length - 1],
      weekIndex: wi,
      weekType,
      weekDays: week.length,
      cltLimit: getWeekLimitHours(isAdm, isNoturno, weekType),
    };
  });

  // Retorna metadados da semana à qual uma data pertence.
  function weekMetaFor(date) {
    return weekMeta.find((wm) => date >= wm.weekStart && date <= wm.weekEnd) ?? null;
  }

  // Conta horas de trabalho in-memory em uma semana.
  function inMemoryWeeklyHours(weekStart, weekEnd) {
    return entries.reduce((sum, e) => {
      if (e.is_day_off || !e.shift_type_id) return sum;
      if (e.date < weekStart || e.date > weekEnd) return sum;
      return sum + (shiftMap[e.shift_type_id]?.duration_hours || 0);
    }, 0);
  }

  // Conta turnos de trabalho in-memory em uma semana (usado para limite ADM por count).
  function inMemoryWeeklyShiftCount(weekStart, weekEnd) {
    return entries.filter((e) => {
      if (e.is_day_off || !e.shift_type_id) return false;
      return e.date >= weekStart && e.date <= weekEnd;
    }).length;
  }

  // Verifica se adicionar `shiftToAdd` respeitaria o limite CLT semanal, dado o meta-objeto da semana.
  function wouldExceedWeeklyLimit(wm, shiftToAdd) {
    const { cltLimit } = wm;
    if (cltLimit.type === 'shifts') {
      return inMemoryWeeklyShiftCount(wm.weekStart, wm.weekEnd) >= cltLimit.limit;
    }
    // type === 'hours'
    return inMemoryWeeklyHours(wm.weekStart, wm.weekEnd) + shiftToAdd.duration_hours > cltLimit.limit;
  }

  // Ao remover turnos (diff > 6), remover primeiro os de maior duração (12h antes de 6h extra).
  const workEntries = entries
    .filter((e) => !e.is_day_off && e.shift_type_id)
    .sort((a, b) => (shiftMap[b.shift_type_id]?.duration_hours || 0) - (shiftMap[a.shift_type_id]?.duration_hours || 0));
  const offEntries  = entries.filter((e) => e.is_day_off);

  if (diff > 6) {
    // Too many hours: convert work days to off days until within tolerance.
    // Guard CLT: nunca remover entrada de semana que já está no/abaixo do limite CLT semanal.
    // Apenas remover de semanas com excesso. Se nenhuma semana tiver excesso, aceitar total > 160h
    // (o modelo CLT é média de 3 meses, não 160h/mês fixo).
    let excess = diff;
    for (const entry of workEntries) {
      if (excess <= 6) break;
      const shift = shiftMap[entry.shift_type_id];
      if (!shift) continue;

      // Guard: verificar se a semana desta entrada ainda está acima do limite CLT.
      if (weeks.length > 0 && (isNewFormat || legacyEffectiveCycleMonth !== null)) {
        const wm = weekMetaFor(entry.date);
        if (wm) {
          const { cltLimit } = wm;
          if (cltLimit.type === 'shifts') {
            const weekShifts = inMemoryWeeklyShiftCount(wm.weekStart, wm.weekEnd);
            if (weekShifts <= cltLimit.limit) continue; // semana já no/abaixo do limite CLT
          } else {
            const weekHours = inMemoryWeeklyHours(wm.weekStart, wm.weekEnd);
            if (weekHours <= cltLimit.limit) continue; // semana já no/abaixo do limite CLT
          }
        }
      }

      entry.shift_type_id = null;
      entry.is_day_off = 1;
      excess -= shift.duration_hours;
    }
  } else if (diff < -6) {
    // Too few hours: convert off days to the sector's preferred shift
    // Preserves lockedOffDates (férias, etc.) and weekly CLT limits.
    const shiftToAdd =
      preferredShift ||
      shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) ||
      shiftTypes[0];

    // Fallback 6h (Manhã/Tarde) para NOTURNO em semana 42h — quando o turno preferido (12h)
    // excederia o limite semanal de 42h já parcialmente preenchido por 3×12h=36h.
    const manhaFallback = isNoturno ? shiftTypes.find((s) => s.name === SHIFT_MANHA_NAME) : null;
    const tardeFallback = isNoturno ? shiftTypes.find((s) => s.name === SHIFT_TARDE_NAME) : null;
    const sixHourFallbacks = [manhaFallback, tardeFallback].filter(Boolean);

    let deficit = Math.abs(diff);
    for (const entry of offEntries) {
      if (deficit <= 0) break;
      if (lockedOffDates.has(entry.date)) continue;

      // Determina o turno candidato respeitando o limite semanal CLT.
      let candidateShift = shiftToAdd;
      if (weeks.length > 0 && (isNewFormat || legacyEffectiveCycleMonth !== null)) {
        const wm = weekMetaFor(entry.date);
        if (wm && wouldExceedWeeklyLimit(wm, candidateShift)) {
          // Para NOTURNO em semana 42h, tenta turno extra de 6h como fallback.
          if (isNoturno && wm.weekType === '42h' && sixHourFallbacks.length > 0) {
            candidateShift = null;
            for (const sixH of sixHourFallbacks) {
              if (!wouldExceedWeeklyLimit(wm, sixH)) { candidateShift = sixH; break; }
            }
            if (!candidateShift) continue;
          } else {
            continue;
          }
        }
      }

      if (!hasAdequateRest(entries, entry, candidateShift, shiftMap)) continue;
      if (wouldExceedConsecutive(entries, entry)) continue;

      entry.is_day_off = 0;
      entry.shift_type_id = candidateShift.id;
      deficit -= candidateShift.duration_hours;
    }
  }

  return entries;
}
