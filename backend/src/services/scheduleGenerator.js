import { getDb, runTransaction } from '../db/database.js';
import { getDaysInMonth, format } from 'date-fns';

// Pares de nomes que formam um "emendado" válido (sem descanso entre eles)
export const EMENDADO_PAIRS = [
  ['Manhã', 'Tarde'],    // 07:00–13:00 + 13:00–19:00 = 12h diurno (regra 11)
  ['Tarde', 'Noturno'],  // 13:00–19:00 + 19:00–07:00 = 18h
  ['Noturno', 'Manhã'],  // 19:00–07:00 + 07:00–13:00 = 18h
];

const MIN_REST_HOURS        = 24;   // Fixo, não editável (regra 10)
const MAX_CONSECUTIVE_HOURS = 18;   // Regra: máximo 18h consecutivas (24h proibido)
const MIN_DAY_MOTORISTAS    = 4;    // Mínimo de motoristas no período diurno
const MIN_NIGHT_MOTORISTAS  = 2;    // Mínimo de motoristas no período noturno
const TARGET_HOURS          = 160;
const DEFAULT_SHIFT_HOURS   = 12;   // Padrão esperado: plantão de 12 horas
const SETOR_ADM             = 'Transporte Administrativo';
const SHIFT_ADM_NAME        = 'Administrativo'; // 10h

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

  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1));
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(format(new Date(year, month - 1, d), 'yyyy-MM-dd'));
  }

  const warnings = [];
  const results = [];

  for (const employee of employees) {
    const result = runTransaction(() => {
      return generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings);
    });
    results.push(result);
  }

  // Regra 5: verificar mínimo de motoristas por período após geração
  checkMotoristaMinimums(db, employees, dates, warnings);

  // Log generation
  db.prepare(
    'INSERT INTO schedule_generations (month, year, params_json) VALUES (?, ?, ?)'
  ).run(month, year, JSON.stringify({ overwriteLocked, employeeCount: employees.length }));

  return { results, warnings };
}

function generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings) {
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id) || { min_rest_hours: MIN_REST_HOURS, days_off_per_week: 1, preferred_shift_id: null };

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

  // Determinar turno preferido e horas base pelo setor (regras 3, 4, 5)
  const isAdm = employee.setor === SETOR_ADM;
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
    // weekIndex % 3 === 0 → semana leve (≤3 turnos), senão pesada (≤4 turnos)
    for (let wi = 0; wi < weeks.length; wi++) {
      const week = weeks[wi];
      const freeInWeek = week.filter((d) => !lockedDates.has(d));

      const lockedOffCount = lockedEntries.filter(
        (e) => e.is_day_off === 1 && week.includes(e.date)
      ).length;

      const daysOffNeeded = Math.max(0, (rules.days_off_per_week ?? 1) - lockedOffCount);

      // Ciclo leve/pesada: 0→leve(3), 1→pesada(4), 2→pesada(4)
      const maxTurnosNaSemana = wi % 3 === 0 ? 3 : 4;
      const maxWorkInWeek = Math.min(freeInWeek.length - daysOffNeeded, maxTurnosNaSemana);
      const actualOffInWeek = freeInWeek.length - Math.max(0, maxWorkInWeek);

      const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
      const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

      for (const date of selectedWork) {
        const shift = selectShift(shiftTypes, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
        if (shift) {
          entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0 });
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
          entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
          consecutiveHours = 0;
          lastShiftName = null;
        }
      }

      for (const date of selectedOff) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
        consecutiveHours = 0;
        lastShiftName = null;
      }
    }
  } else {
    // Ambulância / Hemodiálise — plantão 12h, meta 160h/mês
    const targetWorkDays = Math.round(remainingHours / baseShiftHours);
    let workDaysPlanned = 0;

    for (const week of weeks) {
      const freeInWeek = week.filter((d) => !lockedDates.has(d));

      const lockedOffCount = lockedEntries.filter(
        (e) => e.is_day_off === 1 && week.includes(e.date)
      ).length;

      const daysOffNeeded = Math.max(0, (rules.days_off_per_week ?? 1) - lockedOffCount);
      const maxWorkInWeek = freeInWeek.length - daysOffNeeded;

      const remainingWorkDays = targetWorkDays - workDaysPlanned;
      const actualWorkInWeek = Math.min(maxWorkInWeek, Math.max(0, remainingWorkDays));
      const actualOffInWeek = freeInWeek.length - actualWorkInWeek;

      const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
      const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

      for (const date of selectedWork) {
        const shift = selectShift(shiftTypes, preferredShift, lastShiftEnd, lastShiftName, consecutiveHours, date);
        if (shift) {
          entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0 });
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
          entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
          consecutiveHours = 0;
          lastShiftName = null;
        }
      }

      for (const date of selectedOff) {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
        consecutiveHours = 0;
        lastShiftName = null;
      }
    }
  }

  // Correction step — passa preferredShift para garantir turno correto por setor
  const corrected = correctHours(entries, shiftTypes, shiftMap, totalHours, TARGET_HOURS, preferredShift);

  // Persist
  const insertEntry = db.prepare(
    `INSERT OR REPLACE INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const entry of corrected) {
    insertEntry.run(entry.employee_id, entry.shift_type_id, entry.date, entry.is_day_off, entry.is_locked);
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
  // Ordena candidatos: prefere turno do setor, depois 12h, depois menores
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
      // Só permite emendado se for combo válido
      if (!isValidEmendado(lastShiftName, shift.name)) continue;
      // Bloqueia se emendado ultrapassaria o máximo de horas consecutivas
      if (consecutiveHours + shift.duration_hours > MAX_CONSECUTIVE_HOURS) continue;
      return shift; // Emendado válido
    }

    if (restHours < 0) continue; // Turno já passou

    // Descanso mínimo fixo de 24h (regra 10)
    if (restHours < MIN_REST_HOURS) continue;

    return shift;
  }

  return null;
}

/**
 * Regra 5: verifica mínimo de motoristas por período após geração completa.
 * Todos os empregados são motoristas — filtrar por período é suficiente.
 */
function checkMotoristaMinimums(db, employees, dates, warnings) {
  if (employees.length === 0) return;

  const employeeIds = new Set(employees.map((e) => e.id));

  const dayShiftNames   = new Set(['manhã', 'tarde', 'administrativo']);
  const nightShiftNames = new Set(['noturno']);

  for (const date of dates) {
    const entries = db.prepare(
      `SELECT se.employee_id, st.name as shift_name
       FROM schedule_entries se
       JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date = ? AND se.is_day_off = 0`
    ).all(date);

    const activeEntries = entries.filter((e) => employeeIds.has(e.employee_id));

    const dayCount   = activeEntries.filter((e) => dayShiftNames.has(e.shift_name?.toLowerCase())).length;
    const nightCount = activeEntries.filter((e) => nightShiftNames.has(e.shift_name?.toLowerCase())).length;

    if (dayCount < MIN_DAY_MOTORISTAS) {
      warnings.push({
        type: 'motorista_dia',
        date,
        count: dayCount,
        required: MIN_DAY_MOTORISTAS,
        message: `${date}: apenas ${dayCount} motorista(s) no período diurno (mínimo: ${MIN_DAY_MOTORISTAS})`,
      });
    }

    if (nightCount < MIN_NIGHT_MOTORISTAS) {
      warnings.push({
        type: 'motorista_noite',
        date,
        count: nightCount,
        required: MIN_NIGHT_MOTORISTAS,
        message: `${date}: apenas ${nightCount} motorista(s) no período noturno (mínimo: ${MIN_NIGHT_MOTORISTAS})`,
      });
    }
  }
}

function buildWeeks(dates) {
  const weeks = [];
  let currentWeek = [];

  for (const date of dates) {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // noon to avoid DST issues

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

export function correctHours(entries, shiftTypes, shiftMap, currentHours, target, preferredShift = null) {
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
    // (preferredShift garante que ADM recebe turno de 10h, não 12h)
    const shiftToAdd =
      preferredShift ||
      shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) ||
      shiftTypes[0];
    let deficit = Math.abs(diff);
    for (const entry of offEntries) {
      if (deficit <= 0) break;
      entry.is_day_off = 0;
      entry.shift_type_id = shiftToAdd.id;
      deficit -= shiftToAdd.duration_hours;
    }
  }

  return entries;
}
