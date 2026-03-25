import { useMemo } from 'react';
import { Lock } from 'lucide-react';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_ABBR  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export default function WeekView({ scheduleData, currentMonth, currentYear, onEntryClick }) {
  const { dates, employees, entryMatrix } = useMemo(() => {
    // Deriva as datas diretamente das entries — o período pode cruzar o mês calendário
    const allDates = scheduleData?.entries
      ? [...new Set(scheduleData.entries.map((e) => e.date))].sort()
      : [];

    const dates = allDates.map((date) => {
      // Parsing direto do string "YYYY-MM-DD" evita ambiguidade de timezone do construtor Date.
      // new Date("YYYY-MM-DD") trata como UTC midnight → getDay() pode retornar dia errado.
      const [yearNum, monthNum, dayNum] = date.split('-').map(Number);
      const dow = new Date(Date.UTC(yearNum, monthNum - 1, dayNum)).getUTCDay();
      // Mostra "dia/mês" quando a data pertence a um mês diferente do calendário selecionado
      const label = monthNum !== currentMonth
        ? `${dayNum}/${MONTH_ABBR[monthNum - 1]}`
        : String(dayNum);
      return { date, dayNum: label, dayLabel: DAY_LABELS[dow], dow, isOtherMonth: monthNum !== currentMonth };
    });

    if (!scheduleData?.entries) return { dates, employees: [], entryMatrix: {} };

    // Collect unique employees (with color)
    const empMap = {};
    for (const e of scheduleData.entries) {
      if (!empMap[e.employee_id]) {
        empMap[e.employee_id] = {
          id: e.employee_id,
          name: e.employee_name,
          color: e.employee_color || '#6B7280',
        };
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
              Motorista
            </th>
            {dates.map(({ date, dayNum, dayLabel, dow, isOtherMonth }) => {
              const isWeekend = dow === 0 || dow === 6;
              return (
                <th
                  key={date}
                  className={`px-1 py-1 text-center font-medium border border-gray-200 min-w-[36px] ${
                    isOtherMonth
                      ? 'bg-purple-50 text-purple-600'
                      : isWeekend ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
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
                <td
                  className="sticky left-0 bg-white px-3 py-1.5 font-medium text-gray-700 border border-gray-200 truncate max-w-[160px]"
                  style={{ borderLeft: `3px solid ${emp.color}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="shrink-0 inline-block rounded-full"
                      style={{ width: 8, height: 8, backgroundColor: emp.color }}
                    />
                    {emp.name}
                  </div>
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
                        title={entry.notes || 'Folga'}
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
                      style={{
                        backgroundColor: entry.shift_color || '#e5e7eb',
                        borderLeft: `2px solid ${emp.color}`,
                      }}
                      onClick={() => onEntryClick?.(entry)}
                      title={
                        entry.setor_override
                          ? `${entry.shift_name} (${entry.start_time}–${entry.end_time}) — ${entry.setor_override}`
                          : `${entry.shift_name} (${entry.start_time}–${entry.end_time})`
                      }
                    >
                      <span className="font-bold text-gray-800">{initial}</span>
                      {entry.duration_hours != null && (
                        <span
                          className={`block text-[11px] leading-none mt-0.5 font-semibold ${
                            entry.duration_hours === 6 ? 'text-amber-700' : 'text-gray-900'
                          }`}
                        >
                          {entry.duration_hours}h
                        </span>
                      )}
                      {entry.is_locked ? (
                        <span className="absolute top-0 right-0 text-gray-600">
                          <Lock size={8} />
                        </span>
                      ) : null}
                      {entry.setor_override && (
                        <span className="absolute bottom-0 left-0 w-full h-0.5 bg-amber-400" />
                      )}
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
