import { useMemo } from 'react';
import { format, parseISO, getDaysInMonth, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Lock } from 'lucide-react';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function WeekView({ scheduleData, currentMonth, currentYear, onEntryClick }) {
  const { dates, employees, entryMatrix } = useMemo(() => {
    const daysInMonth = getDaysInMonth(new Date(currentYear, currentMonth - 1, 1));
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dates.push({ date, dayNum: d, dayLabel: DAY_LABELS[new Date(date).getDay()] });
    }

    if (!scheduleData?.entries) return { dates, employees: [], entryMatrix: {} };

    // Collect unique employees
    const empMap = {};
    for (const e of scheduleData.entries) {
      if (!empMap[e.employee_id]) {
        empMap[e.employee_id] = { id: e.employee_id, name: e.employee_name };
      }
    }
    const employees = Object.values(empMap).sort((a, b) => a.name.localeCompare(b.name));

    // Build matrix
    const matrix = {};
    for (const entry of scheduleData.entries) {
      if (!matrix[entry.employee_id]) matrix[entry.employee_id] = {};
      matrix[entry.employee_id][entry.date] = entry;
    }

    return { dates, employees, entryMatrix: matrix };
  }, [scheduleData, currentMonth, currentYear]);

  if (employees.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Nenhuma escala gerada para este período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 text-left px-3 py-2 font-semibold text-gray-600 border border-gray-200 min-w-[140px]">
              Funcionário
            </th>
            {dates.map(({ date, dayNum, dayLabel }) => {
              const isWeekend = [0, 6].includes(new Date(date).getDay());
              return (
                <th
                  key={date}
                  className={`px-1 py-1 text-center font-medium border border-gray-200 min-w-[36px] ${
                    isWeekend ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
                  }`}
                >
                  <div>{dayLabel}</div>
                  <div className="font-bold">{dayNum}</div>
                </th>
              );
            })}
            <th className="px-2 py-2 text-center font-semibold text-gray-600 border border-gray-200 min-w-[60px]">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const empEntries = entryMatrix[emp.id] || {};
            let totalHours = 0;

            return (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium text-gray-700 border border-gray-200 truncate max-w-[160px]">
                  {emp.name}
                </td>
                {dates.map(({ date }) => {
                  const entry = empEntries[date];
                  if (!entry) {
                    return (
                      <td key={date} className="border border-gray-200 text-center text-gray-300">
                        —
                      </td>
                    );
                  }
                  if (entry.is_day_off) {
                    return (
                      <td
                        key={date}
                        className="border border-gray-200 text-center bg-gray-100 text-gray-400 cursor-pointer hover:bg-gray-200"
                        onClick={() => onEntryClick?.(entry)}
                      >
                        F
                      </td>
                    );
                  }
                  totalHours += entry.duration_hours || 0;
                  const initial = entry.shift_name?.charAt(0) || '?';
                  return (
                    <td
                      key={date}
                      className="border border-gray-200 text-center cursor-pointer hover:opacity-80 relative"
                      style={{ backgroundColor: entry.shift_color || '#e5e7eb' }}
                      onClick={() => onEntryClick?.(entry)}
                      title={`${entry.shift_name} (${entry.start_time}–${entry.end_time})`}
                    >
                      <span className="font-bold text-gray-800">{initial}</span>
                      {entry.is_locked ? (
                        <span className="absolute top-0 right-0 text-gray-600">
                          <Lock size={8} />
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td
                  className={`border border-gray-200 text-center font-bold tabular-nums ${
                    Math.abs(totalHours - 160) <= 12 ? 'text-green-700' : 'text-orange-600'
                  }`}
                >
                  {totalHours}h
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
