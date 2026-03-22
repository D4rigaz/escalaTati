import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('label "12h" tem cor de alto contraste (text-gray-900)', () => {
    const entry = makeEntry({ duration_hours: 12 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    const label = screen.getByText('12h', { selector: 'span' });
    expect(label).toHaveClass('text-gray-900');
    expect(label).not.toHaveClass('text-amber-700');
  });

  it('label de duração não renderiza quando duration_hours é null (null guard)', () => {
    const entry = makeEntry({ duration_hours: null, is_day_off: 0 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(screen.queryByText('h', { selector: 'span' })).not.toBeInTheDocument();
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

// ── Cabeçalho de dias (issue #73) ─────────────────────────────────────────────

describe('WeekView — cabeçalho de dias (issue #73)', () => {
  it('exibe todos os 7 labels de dias da semana no cabeçalho', () => {
    // Fornece uma entry por dia da semana (Mar 1 Dom … Mar 7 Sáb) para que todos
    // os 7 labels apareçam — o componente deriva colunas diretamente das entries.
    const dates = ['2026-03-01','2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07'];
    const entries = dates.map((date, i) => makeEntry({ id: i + 1, date }));
    render(
      <WeekView
        scheduleData={makeScheduleData(entries)}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    for (const label of ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});

// ── Interação de clique (issue #73) ───────────────────────────────────────────

describe('WeekView — interação de clique (issue #73)', () => {
  it('clique em célula de turno chama onEntryClick com a entry correta', () => {
    const onEntryClick = vi.fn();
    const entry = makeEntry();
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
        onEntryClick={onEntryClick}
      />
    );
    // Clica na inicial do turno ('N' de Noturno) — evento burbulha até o td
    fireEvent.click(screen.getByText('N'));
    expect(onEntryClick).toHaveBeenCalledOnce();
    expect(onEntryClick).toHaveBeenCalledWith(entry);
  });

  it('clique em célula de folga chama onEntryClick com a entry correta', () => {
    const onEntryClick = vi.fn();
    const entry = makeEntry({ is_day_off: 1 });
    render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
        onEntryClick={onEntryClick}
      />
    );
    fireEvent.click(screen.getByText('F'));
    expect(onEntryClick).toHaveBeenCalledOnce();
    expect(onEntryClick).toHaveBeenCalledWith(entry);
  });

  it('célula bloqueada exibe ícone de cadeado (Lock svg)', () => {
    const entry = makeEntry({ is_locked: 1 });
    const { container } = render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    // Lock de lucide-react renderiza como SVG
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('célula não-bloqueada não exibe ícone de cadeado', () => {
    const entry = makeEntry({ is_locked: 0 });
    const { container } = render(
      <WeekView
        scheduleData={makeScheduleData([entry])}
        currentMonth={MONTH}
        currentYear={YEAR}
      />
    );
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});

// ── Coluna de total (issue #73) ────────────────────────────────────────────────

describe('WeekView — coluna de total (issue #73)', () => {
  it('total do motorista exibe soma das horas de trabalho do mês', () => {
    const entries = [
      makeEntry({ id: 1, date: '2026-03-03', duration_hours: 12 }),
      makeEntry({ id: 2, date: '2026-03-05', duration_hours: 12 }),
      makeEntry({ id: 3, date: '2026-03-07', duration_hours: 12 }),
    ];
    render(
      <WeekView scheduleData={makeScheduleData(entries)} currentMonth={MONTH} currentYear={YEAR} />
    );
    expect(screen.getByText('36h', { selector: 'td' })).toBeInTheDocument();
  });

  it('total dentro de ±12h de 160h tem classe text-green-700', () => {
    // 13 × 12h = 156h — desvio de -4h, dentro do intervalo ±12h
    const entries = Array.from({ length: 13 }, (_, i) => makeEntry({
      id: i + 1,
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      duration_hours: 12,
    }));
    render(
      <WeekView scheduleData={makeScheduleData(entries)} currentMonth={MONTH} currentYear={YEAR} />
    );
    expect(screen.getByText('156h', { selector: 'td' })).toHaveClass('text-green-700');
  });

  it('total fora de ±12h de 160h tem classe text-orange-600', () => {
    // 1 × 12h = 12h — desvio de -148h, fora do intervalo ±12h
    const entry = makeEntry({ duration_hours: 12 });
    render(
      <WeekView scheduleData={makeScheduleData([entry])} currentMonth={MONTH} currentYear={YEAR} />
    );
    expect(screen.getByText('12h', { selector: 'td' })).toHaveClass('text-orange-600');
  });
});
