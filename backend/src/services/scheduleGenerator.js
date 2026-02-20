import { getDb, runTransaction } from '../db/database.js';
import { getDaysInMonth, format } from 'date-fns';

// Pares de nomes que formam um "emendado" válido (sem descanso entre eles)
const EMENDADO_PAIRS = [
  ['Tarde', 'Noturno'],  // 12:00–18:00 + 18:00–06:00 = 18h
  ['Noturno', 'Manhã'],  // 18:00–06:00 + 06:00–12:00 = 18h
];

const MAX_CONSECUTIVE_HOURS = 18; // Regra: máximo 18h consecutivas (24h proibido)
const MIN_DAY_MOTORISTAS    = 4;  // Mínimo de motoristas no período diurno
const MIN_NIGHT_MOTORISTAS  = 2;  // Mínimo de motoristas no período noturno
const TARGET_HOURS          = 160;
const DEFAULT_SHIFT_HOURS   = 12; // Padrão esperado: plantão de 12 horas

/**
 * Verifica se dois turnos formam um emendado válido (sem descanso).
 */
function isValidEmendado(prevShiftName, nextShiftName) {
  return EMENDADO_PAIRS.some(
    ([a, b]) => a === prevShiftName && b === nextShiftName
  );
}

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
    const result = runTransaction(() =>
      generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings)
    );
    results.push(result);
  }

  // Regra 5: verificar mínimo de motoristas por período após geração
  checkMotoristaMinimums(db, employees, shiftTypes, dates, warnings);

  db.prepare(
    'INSERT INTO schedule_generations (month, year, params_json) VALUES (?, ?, ?)'
  ).run(month, year, JSON.stringify({ overwriteLocked, employeeCount: employees.length }));

  return { results, warnings };
}

function generateForEmployee(db, employee, shiftTypes, shiftMap, dates, overwriteLocked, warnings) {
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id) || { min_rest_hours: 11, days_off_per_week: 1, preferred_shift_id: null };

  const lockedEntries = db
    .prepare(
      'SELECT * FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ? AND is_locked = 1'
    )
    .all(employee.id, dates[0], dates[dates.length - 1]);

  const lockedDates = new Set(lockedEntries.map((e) => e.date));

  if (overwriteLocked) {
    db.prepare('DELETE FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ?')
      .run(employee.id, dates[0], dates[dates.length - 1]);
  } else {
    db.prepare('DELETE FROM schedule_entries WHERE employee_id = ? AND date >= ? AND date <= ? AND is_locked = 0')
      .run(employee.id, dates[0], dates[dates.length - 1]);
  }

  const weeks = buildWeeks(dates);

  let totalHours = 0;
  let lastShiftEnd = null;
  let lastShiftName = null;
  let consecutiveHours = 0;
  const entries = [];

  // Contabiliza horas das entradas bloqueadas
  for (const entry of lockedEntries) {
    if (!entry.is_day_off && entry.shift_type_id) {
      const shift = shiftMap[entry.shift_type_id];
      if (shift) totalHours += shift.duration_hours;
    }
  }

  // Regra 1: padrão é 12h — usa turno de 12h como referência para o planejamento
  const preferredShift = rules.preferred_shift_id
    ? shiftTypes.find((s) => s.id === rules.preferred_shift_id)
    : shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) || shiftTypes[0];
  const baseShiftHours = preferredShift?.duration_hours || DEFAULT_SHIFT_HOURS;

  const lockedWorkHours = totalHours;
  const remainingHours = Math.max(0, TARGET_HOURS - lockedWorkHours);
  const targetWorkDays = Math.round(remainingHours / baseShiftHours);
  let workDaysPlanned = 0;

  for (const week of weeks) {
    const freeInWeek = week.filter((d) => !lockedDates.has(d));

    const lockedOffCount = lockedEntries.filter(
      (e) => e.is_day_off === 1 && week.includes(e.date)
    ).length;

    // Regra 3: mínimo 1 folga de 24h por semana (1 dia livre = 24h contínuas garantidas)
    const daysOffNeeded = Math.max(0, (rules.days_off_per_week ?? 1) - lockedOffCount);
    const maxWorkInWeek = freeInWeek.length - daysOffNeeded;

    const remainingWorkDays = targetWorkDays - workDaysPlanned;
    const actualWorkInWeek = Math.min(maxWorkInWeek, Math.max(0, remainingWorkDays));
    const actualOffInWeek = freeInWeek.length - actualWorkInWeek;

    const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
    const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

    for (const date of selectedWork) {
      const shift = selectShift(shiftTypes, rules, lastShiftEnd, lastShiftName, consecutiveHours, date);
      if (shift) {
        entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0 });
        totalHours += shift.duration_hours;

        const shiftStart = computeShiftStart(date, shift);
        const restHours = lastShiftEnd
          ? (shiftStart - lastShiftEnd) / (1000 * 60 * 60)
          : Infinity;

        // Acumula horas consecutivas se emendando (0h de descanso), senão reinicia
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
      // Folga garante quebra de sequência consecutiva (Regra 3)
      consecutiveHours = 0;
      lastShiftName = null;
    }
  }

  const corrected = correctHours(entries, shiftTypes, shiftMap, totalHours, TARGET_HOURS);

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
 * - Regra 1/2: prefere 12h; permite emendado de 18h
 * - Regra 2: bloqueia se consecutiveHours + próximo turno >= 24h
 * - Regra 4: emendado Tarde→Noturno e Noturno→Manhã são os únicos sem descanso permitidos
 */
function selectShift(shiftTypes, rules, lastShiftEnd, lastShiftName, consecutiveHours, date) {
  // Ordena candidatos: prefere 12h, depois menores
  const sorted = [...shiftTypes].sort((a, b) => {
    const preferA = a.duration_hours === DEFAULT_SHIFT_HOURS ? 0 : 1;
    const preferB = b.duration_hours === DEFAULT_SHIFT_HOURS ? 0 : 1;
    return preferA - preferB;
  });

  const preferred = rules.preferred_shift_id
    ? shiftTypes.find((s) => s.id === rules.preferred_shift_id)
    : null;

  const candidates = preferred
    ? [preferred, ...sorted.filter((s) => s.id !== preferred.id)]
    : sorted;

  for (const shift of candidates) {
    if (!lastShiftEnd) return shift; // Primeiro turno: sem restrições

    const shiftStart = computeShiftStart(date, shift);
    const restHours = (shiftStart - lastShiftEnd) / (1000 * 60 * 60);

    if (restHours === 0) {
      // Regra 4: só permite emendado se for combo válido (Tarde→Noturno ou Noturno→Manhã)
      if (!isValidEmendado(lastShiftName, shift.name)) continue;

      // Regra 2: bloqueia se emendado resultaria em 24h+ consecutivas
      if (consecutiveHours + shift.duration_hours >= 24) continue;

      return shift; // Emendado válido
    }

    if (restHours < 0) continue; // Turno já passou

    // Descanso normal: verifica min_rest_hours
    if (restHours < (rules.min_rest_hours ?? 11)) continue;

    return shift;
  }

  return null;
}

/**
 * Regra 5: verifica mínimo de motoristas por período após geração completa.
 */
function checkMotoristaMinimums(db, employees, shiftTypes, dates, warnings) {
  const motoristas = employees.filter(
    (e) => e.cargo?.toLowerCase() === 'motorista'
  );
  if (motoristas.length === 0) return;

  const motoristIds = new Set(motoristas.map((e) => e.id));

  const dayShiftNames  = new Set(['Manhã', 'Tarde']);
  const nightShiftNames = new Set(['Noturno']);

  for (const date of dates) {
    const entries = db.prepare(
      `SELECT se.employee_id, st.name as shift_name
       FROM schedule_entries se
       JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date = ? AND se.is_day_off = 0`
    ).all(date);

    const motoristaEntries = entries.filter((e) => motoristIds.has(e.employee_id));

    const dayCount   = motoristaEntries.filter((e) => dayShiftNames.has(e.shift_name)).length;
    const nightCount = motoristaEntries.filter((e) => nightShiftNames.has(e.shift_name)).length;

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
  const [h, m] = shift.start_time.split(':').map(Number);
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
}

function computeShiftEnd(date, shift) {
  const start = computeShiftStart(date, shift);
  return new Date(start.getTime() + shift.duration_hours * 60 * 60 * 1000);
}

function correctHours(entries, shiftTypes, shiftMap, currentHours, target) {
  const diff = currentHours - target;
  if (Math.abs(diff) <= 6) return entries;

  const workEntries = entries.filter((e) => !e.is_day_off && e.shift_type_id);
  const offEntries  = entries.filter((e) => e.is_day_off);

  if (diff > 6) {
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
    // Regra 1: ao adicionar horas, prefere turno padrão de 12h
    const shiftToAdd =
      shiftTypes.find((s) => s.duration_hours === DEFAULT_SHIFT_HOURS) ||
      shiftTypes.find((s) => s.duration_hours === 6) ||
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
