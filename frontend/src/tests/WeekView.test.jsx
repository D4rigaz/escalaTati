import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WeekView from '../components/schedule/WeekView.jsx';

const MONTH = 3;
const YEAR = 2026;

function makeEntry(overrides) {
  return {
    id: 1,
    employee_id: 10,
    employee_name: 'Ana',
    employee_color: '#6B7280',
    date: '2026-03-03',
    is_day_off: 0,
    is_locked: 0,
    shift_name: 'Noturno',
    shift_color: '#1e3a5f',
    start_time: '19:00',
    end_time: '07:00',
    duration_hours: 12,
    setor_override: null,
    notes: null,
    ...overrides,
  };
}

function makeScheduleData(entries) {
  return { entries };
}

// ── Label de duração ──────────────────────────────────────────────────────────

describe('WeekView — label de duração do turno', () => {
  it('turno de 12h exibe label "12h"', () => {
    const entry = makeEntry({ duration_hours: 12 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    // selector: 'span' evita match com a célula de total (td)
    expect(screen.getByText('12h', { selector: 'span' })).toBeInTheDocument();
  });

  it('turno de 6h exibe label "6h"', () => {
    const entry = makeEntry({
      duration_hours: 6,
      shift_name: 'Manhã',
      start_time: '07:00',
      end_time: '13:00',
    });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText('6h', { selector: 'span' })).toBeInTheDocument();
  });

  it('label "6h" tem classe de destaque visual (text-amber-700)', () => {
    const entry = makeEntry({ duration_hours: 6, shift_name: 'Tarde' });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    const label = screen.getByText('6h', { selector: 'span' });
    expect(label).toHaveClass('text-amber-700');
  });

  it('label "12h" não tem classe de destaque (text-gray-600)', () => {
    const entry = makeEntry({ duration_hours: 12 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    const label = screen.getByText('12h', { selector: 'span' });
    expect(label).toHaveClass('text-gray-600');
    expect(label).not.toHaveClass('text-amber-700');
  });

  it('célula de folga não exibe label de duração', () => {
    const entry = makeEntry({ is_day_off: 1, duration_hours: null });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.queryByText('12h')).not.toBeInTheDocument();
    expect(screen.queryByText('6h')).not.toBeInTheDocument();
  });

  it('dois turnos no mesmo mês exibem durações independentes', () => {
    const entries = [
      makeEntry({ id: 1, date: '2026-03-03', duration_hours: 12, shift_name: 'Noturno' }),
      makeEntry({ id: 2, date: '2026-03-10', duration_hours: 6, shift_name: 'Manhã' }),
    ];
    render(
      <WeekView
        scheduleData={makeScheduleData(entries)}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText('12h')).toBeInTheDocument();
    expect(screen.getByText('6h')).toBeInTheDocument();
  });
});

// ── Comportamento base (regressão) ────────────────────────────────────────────

describe('WeekView — renderização base', () => {
  it('sem escala: exibe mensagem de período vazio', () => {
    render(
      <WeekView
        scheduleData={null}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText(/Nenhuma escala gerada/i)).toBeInTheDocument();
  });

  it('exibe nome do motorista na linha', () => {
    const entry = makeEntry({ employee_name: 'Bruno' });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText('Bruno')).toBeInTheDocument();
  });

  it('célula de turno exibe inicial do nome do turno', () => {
    const entry = makeEntry({ shift_name: 'Noturno' });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('célula de folga exibe "F"', () => {
    const entry = makeEntry({ is_day_off: 1 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.getByText('F')).toBeInTheDocument();
  });
});
