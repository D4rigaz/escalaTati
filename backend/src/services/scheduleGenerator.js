import { getDb, runTransaction } from '../db/database.js';
import { getDaysInMonth, format, differenceInHours, parseISO } from 'date-fns';

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
  const TARGET_HOURS = 160;
  const results = [];

  for (const employee of employees) {
    const result = runTransaction(() => {
      return generateForEmployee(db, employee, shiftTypes, shiftMap, dates, month, year, overwriteLocked, TARGET_HOURS, warnings);
    });
    results.push(result);
  }

  // Log generation
  db.prepare(
    'INSERT INTO schedule_generations (month, year, params_json) VALUES (?, ?, ?)'
  ).run(month, year, JSON.stringify({ overwriteLocked, employeeCount: employees.length }));

  return { results, warnings };
}

function generateForEmployee(db, employee, shiftTypes, shiftMap, dates, month, year, overwriteLocked, TARGET_HOURS, warnings) {
  const rules = db
    .prepare('SELECT * FROM employee_rest_rules WHERE employee_id = ?')
    .get(employee.id) || { min_rest_hours: 11, days_off_per_week: 1, preferred_shift_id: null };

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

  // Build weekly groups (Sun-based)
  const weeks = buildWeeks(dates);

  let totalHours = 0;
  let lastShiftEnd = null;
  const entries = [];

  // Count locked hours
  for (const entry of lockedEntries) {
    if (!entry.is_day_off && entry.shift_type_id) {
      const shift = shiftMap[entry.shift_type_id];
      if (shift) totalHours += shift.duration_hours;
    }
  }

  // Determine preferred shift hours to plan work days correctly
  const preferredShift = rules.preferred_shift_id
    ? shiftTypes.find((s) => s.id === rules.preferred_shift_id)
    : shiftTypes.find((s) => s.duration_hours === 6) || shiftTypes[0];
  const shiftHours = preferredShift?.duration_hours || 6;

  // Calculate how many total work days we need across the month
  const totalFreeDays = dates.filter((d) => !lockedDates.has(d)).length;
  const lockedWorkHours = totalHours; // hours already from locked entries
  const remainingHours = Math.max(0, TARGET_HOURS - lockedWorkHours);
  const targetWorkDays = Math.round(remainingHours / shiftHours);
  let workDaysPlanned = 0;

  for (const week of weeks) {
    const freeInWeek = week.filter((d) => !lockedDates.has(d));

    const lockedOffCount = lockedEntries.filter(
      (e) => e.is_day_off === 1 && week.includes(e.date)
    ).length;

    const daysOffNeeded = Math.max(0, (rules.days_off_per_week ?? 1) - lockedOffCount);
    const maxWorkInWeek = freeInWeek.length - daysOffNeeded;

    // Determine actual work days for this week based on remaining target
    const remainingWorkDays = targetWorkDays - workDaysPlanned;
    const actualWorkInWeek = Math.min(maxWorkInWeek, Math.max(0, remainingWorkDays));
    const actualOffInWeek = freeInWeek.length - actualWorkInWeek;

    const selectedOff = selectOffDays(freeInWeek, actualOffInWeek);
    const selectedWork = freeInWeek.filter((d) => !selectedOff.includes(d));

    for (const date of selectedWork) {
      const shift = selectShift(shiftTypes, rules, lastShiftEnd, date);
      if (shift) {
        entries.push({ employee_id: employee.id, shift_type_id: shift.id, date, is_day_off: 0, is_locked: 0 });
        totalHours += shift.duration_hours;
        lastShiftEnd = computeShiftEnd(date, shift);
        workDaysPlanned++;
      } else {
        entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
      }
    }

    for (const date of selectedOff) {
      entries.push({ employee_id: employee.id, shift_type_id: null, date, is_day_off: 1, is_locked: 0 });
    }
  }

  // Correction step
  const corrected = correctHours(entries, shiftTypes, shiftMap, totalHours, TARGET_HOURS);

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

function selectShift(shiftTypes, rules, lastShiftEnd, date) {
  const preferred = rules.preferred_shift_id
    ? shiftTypes.find((s) => s.id === rules.preferred_shift_id)
    : null;

  const candidates = preferred
    ? [preferred, ...shiftTypes.filter((s) => s.id !== preferred.id)]
    : [...shiftTypes];

  for (const shift of candidates) {
    if (lastShiftEnd) {
      const shiftStart = computeShiftStart(date, shift);
      const restHours = (shiftStart - lastShiftEnd) / (1000 * 60 * 60);
      if (restHours < (rules.min_rest_hours ?? 11)) continue;
    }
    return shift;
  }
  return null;
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
  const offEntries = entries.filter((e) => e.is_day_off);

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
    // Too few hours: convert off days to 6h work shifts
    const shiftToAdd = shiftTypes.find((s) => s.duration_hours === 6) || shiftTypes[0];
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
