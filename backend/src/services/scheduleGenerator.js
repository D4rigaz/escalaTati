import { getDb, runTransaction } from '../db/database.js';
import { getDaysInMonth, format } from 'date-fns';

// Pares de nomes que formam um "emendado" válido (sem descanso entre eles)
export const EMENDADO_PAIRS = [
  ['Manhã', 'Tarde'],    // 07:00–13:00 + 13:00–19:00 = 12h diurno (regra 11)
  ['Tarde', 'Noturno'],  // 13:00–19:00 + 19:00–07:00 = 18h
  ['Noturno', 'Manhã'],  // 19:00–07:00 + 07:00–13:00 = 18h
];

const MIN_REST_HOURS           = 24;  // Fixo, não editável (regra 10)
const MAX_CONSECUTIVE_HOURS    = 18;  // Regra: máximo 18h consecutivas
const MAX_CONSECUTIVE_WORK_DAYS = 6;  // Regra: máximo 6 dias de trabalho consecutivos
const TARGET_HOURS          = 160;
const DEFAULT_SHIFT_HOURS   = 12;   // Padrão esperado: plantão de 12 horas
const SETOR_ADM             = 'Transporte Administrativo';
const SETOR_AMBUL           = 'Transporte Ambulância';
const SETOR_HEMO            = 'Transporte Hemodiálise';
const SHIFT_ADM_NAME        = 'Administrativo'; // 10h
const SHIFT_DIURNO_NAME     = 'Diurno';         // 12h (regra 16)
const SHIFT_NOTURNO_NAME    = 'Noturno';        // 12h (regras 21/22)

/**
 * Verifica se dois turnos formam um emendado válido (sem descanso).
 */
export function isValidEmendado(prevShiftName, nextShiftName) {
  return EMENDADO_PAIRS.some(
    ([a, b]) => a === prevShiftName && b === nextShiftName
  );
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

  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1));
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(format(new Date(year, month - 1, d), 'yyyy-MM-dd'));
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

  const warnings = [];
  const results = [];

  for (const employee of employees) {
    const result = runTransaction(() => {
      return generateForEmployee(
        db, employee, shiftTypes, shiftMap, dates,
        overwriteLocked, warnings, allVacationDates
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
  ).run(month, year, JSON.stringify({ overwriteLocked, employeeCount: employees.length }));

  return { results, warnings };
}

function generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings, allVacationDates) {
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

      // Ciclo leve/pesada: 0→leve(3), 1→pesada(4), 2→pesada(4)
      const maxTurnosNaSemana = wi % 3 === 0 ? 3 : 4;
      const maxWorkInWeek = Math.min(freeInWeek.length, maxTurnosNaSemana);
      const actualOffInWeek = freeInWeek.length - Math.max(0, maxWorkInWeek);

      const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
      const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

      for (const date of selectedWork) {
        const shift = selectShift(shiftTypes, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
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
    const targetWorkDays = Math.round(remainingHours / baseShiftHours);
    let workDaysPlanned = 0;

    for (const week of weeks) {
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

      const remainingWorkDays = targetWorkDays - workDaysPlanned;
      // Garante mínimo 1 folga/semana quando não há férias ou forced-off (Regra: máx 6 dias consecutivos)
      const existingOffInWeek = vacInWeek.length + forcedOff.length;
      const minOffNeeded = freeInWeek.length > 0 ? Math.max(0, 1 - existingOffInWeek) : 0;
      const actualWorkInWeek = Math.min(freeInWeek.length - minOffNeeded, Math.max(0, remainingWorkDays));
      const actualOffInWeek = freeInWeek.length - actualWorkInWeek;

      const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
      const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

      for (const date of selectedWork) {
        const shift = selectShift(shiftTypes, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
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
          workDaysPlanned++;
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
  }

  // Correction step — preserva lockedOffDates (férias)
  const corrected = correctHours(entries, shiftTypes, shiftMap, totalHours, TARGET_HOURS, preferredShift, lockedOffDates);

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

  return { employee: employee.name, hours: finalHours };
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
 * Converte folgas (não bloqueadas) dos motoristas elegíveis se necessário.
 */
function enforceDiurnoCoverage(db, employees, employeeSectorsMap, dates, diurnoShift, warnings) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

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
 */
function enforceNocturnalCoverage(db, employees, employeeSectorsMap, dates, noturnoShift, warnings) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

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
        // Regra 12: seg_sex nunca trabalha Sábado (dow=6); domingo já tem required=0 acima.
        if (emp.work_schedule === 'seg_sex' && dow === 6) continue;
        const entry = entryByEmp[emp.id];
        if (!entry || !entry.is_day_off || entry.is_locked || entry.notes === 'Férias') continue;
        if (!canAssignShift(db, emp.id, date, noturnoShift)) continue;
        if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
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
 * Rule 19 (enforcement): Garante que todo dia do mês tem pelo menos 1 motorista.
 * @exported para testes unitários
 * Passa 1: converte folga de candidato elegível respeitando restrições de descanso.
 * Passo 2 (fallback): força a conversão ignorando MIN_REST_HOURS e dias consecutivos.
 * Respeita work_schedule=seg_sex mesmo no passo forçado.
 * Emite warning quando a cobertura foi forçada ou quando é impossível.
 */
export function enforceDailyCoverage(db, employees, employeeSectorsMap, shiftTypes, dates, warnings) {
  const defaultShift =
    shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) || shiftTypes[0];

  // Cache preferred shift por employee_id
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
    const fallback = isAdm
      ? (shiftTypes.find((s) => s.name === SHIFT_ADM_NAME) || defaultShift)
      : defaultShift;
    preferredShiftCache[emp.id] = fallback;
    return fallback;
  };

  for (const date of dates) {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM schedule_entries
         WHERE date = ? AND is_day_off = 0
           AND employee_id IN (SELECT id FROM employees WHERE active = 1)`
      )
      .get(date);
    if (row.c > 0) continue;

    const dow = new Date(date + 'T12:00:00').getDay();

    // Candidatos: folgas não-bloqueadas e não-férias neste dia
    const folgas = db
      .prepare(
        `SELECT se.id, se.employee_id FROM schedule_entries se
         WHERE se.date = ? AND se.is_day_off = 1 AND se.is_locked = 0
           AND (se.notes IS NULL OR se.notes != 'Férias')
           AND se.employee_id IN (SELECT id FROM employees WHERE active = 1)`
      )
      .all(date);

    if (folgas.length === 0) {
      warnings.push({ type: 'sem_motorista', date, message: `${date}: nenhum motorista escalado` });
      continue;
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

    const startDate = dates[0];
    const endDate   = dates[dates.length - 1];

    // Passo 1: com restrições de descanso e cap de horas
    let assigned = false;
    for (const { folgaId, emp } of candidates) {
      if (emp.work_schedule === 'seg_sex' && (dow === 0 || dow === 6)) continue;
      if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
      const shift = getShiftForEmp(emp);
      if (!canAssignShift(db, emp.id, date, shift)) continue;
      db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
        .run(shift.id, folgaId);
      assigned = true;
      break;
    }
    if (assigned) continue;

    // Passo 2: forçado — ignora restrições de descanso e consecutivos, mantém cap de horas
    let forced = false;
    for (const { folgaId, emp } of candidates) {
      if (emp.work_schedule === 'seg_sex' && (dow === 0 || dow === 6)) continue;
      if (getEmployeeHours(db, emp.id, startDate, endDate) >= COVERAGE_HOURS_CAP) continue;
      const shift = getShiftForEmp(emp);
      db.prepare('UPDATE schedule_entries SET is_day_off = 0, shift_type_id = ? WHERE id = ?')
        .run(shift.id, folgaId);
      warnings.push({
        type: 'sem_motorista_forcado',
        date,
        employee: emp.name,
        message: `${date}: cobertura diária forçada para ${emp.name} (restrições de descanso ignoradas)`,
      });
      forced = true;
      break;
    }
    if (!forced) {
      warnings.push({ type: 'sem_motorista', date, message: `${date}: nenhum motorista escalado` });
    }
  }
}

function buildWeeks(dates) {
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

function selectOffDays(freeDays, count) {
  if (count <= 0 || freeDays.length === 0) return [];
  return [...freeDays].reverse().slice(0, count);
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
        if (restMs < MIN_REST_HOURS * 3_600_000) return false;
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
        if (restMs < MIN_REST_HOURS * 3_600_000) return false;
      }
    }
  }

  return true;
}

export function correctHours(entries, shiftTypes, shiftMap, currentHours, target, preferredShift = null, lockedOffDates = new Set()) {
  const diff = currentHours - target;
  if (Math.abs(diff) <= 6) return entries;

  const workEntries = entries.filter((e) => !e.is_day_off && e.shift_type_id);
  const offEntries  = entries.filter((e) => e.is_day_off);

  if (diff > 6) {
    // Too many hours: convert work days to off days until within tolerance
    let excess = diff;
    for (const entry of workEntries) {
      if (excess <= 6) break;
      const shift = shiftMap[entry.shift_type_id];
      if (shift) {
        entry.shift_type_id = null;
        entry.is_day_off = 1;
        excess -= shift.duration_hours;
      }
    }
  } else if (diff < -6) {
    // Too few hours: convert off days to the sector's preferred shift
    // Preserves lockedOffDates (férias, etc.)
    const shiftToAdd =
      preferredShift ||
      shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) ||
      shiftTypes[0];
    let deficit = Math.abs(diff);
    for (const entry of offEntries) {
      if (deficit <= 0) break;
      if (lockedOffDates.has(entry.date)) continue;
      if (!hasAdequateRest(entries, entry, shiftToAdd, shiftMap)) continue;
      if (wouldExceedConsecutive(entries, entry)) continue;
      entry.is_day_off = 0;
      entry.shift_type_id = shiftToAdd.id;
      deficit -= shiftToAdd.duration_hours;
    }
  }

  return entries;
}
