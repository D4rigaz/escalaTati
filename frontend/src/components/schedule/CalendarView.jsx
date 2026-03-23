import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useMemo, useRef } from 'react';

export default function CalendarView({ scheduleData, currentMonth, currentYear, onEntryClick }) {
  const calendarRef = useRef(null);

  const events = useMemo(() => {
    if (!scheduleData?.entries) return [];
    return scheduleData.entries
      .filter((e) => !e.is_day_off)
      .map((entry) => {
        const empColor = entry.employee_color || '#93C5FD';
        const setorLabel = entry.setor_override || null;
        const title = setorLabel
          ? `${entry.employee_name}: ${entry.shift_name || ''} (${setorLabel})`
          : `${entry.employee_name}: ${entry.shift_name || ''}`;
        return {
          id: String(entry.id),
          title,
          start: entry.date,
          backgroundColor: empColor,
          borderColor: empColor,
          textColor: isDark(empColor) ? '#fff' : '#1f2937',
          extendedProps: { entry },
        };
      });
  }, [scheduleData]);

  const initialDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

  return (
    <div className="h-full">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        initialDate={initialDate}
        locale="pt-br"
        firstDay={0}
        events={events}
        eventClick={(info) => {
          const entry = info.event.extendedProps.entry;
          onEntryClick?.(entry);
        }}
        headerToolbar={false}
        height="auto"
        dayMaxEvents={5}
        eventDisplay="block"
      />
    </div>
  );
}

function isDark(hex) {
  if (!hex) return false;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return false;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}
