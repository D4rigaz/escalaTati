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

// ── Validação Motorista Alex — Semana 0 Abril/2026 (bug #135/#136) ────────────
// Dados de referência gerados pelo backend (validados pelo PO em 2026-03-23):
//   Semana 0 (05/04–11/04): Dom Manhã(6h), Ter Diurno(12h), Qui Diurno(12h), Sex Noturno(12h)
//   Semanas 0 e 1 = 42h cada (weekType='42h' — GLOBAL_PATTERN_12)

const ALEX_ID = 102;
const APR = 4;
const APR_YEAR = 2026;

// Semana 0 de Abril/2026 exatamente como o backend gera
const alexWeek0Entries = [
  { id: 1001, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-05', is_day_off: 0, is_locked: 0,
    shift_name: 'Manhã', shift_color: '#FCD34D', start_time: '07:00', end_time: '13:00',
    duration_hours: 6, setor_override: null, notes: null },
  { id: 1002, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-06', is_day_off: 1, is_locked: 0,
    shift_name: null, shift_color: null, start_time: null, end_time: null,
    duration_hours: null, setor_override: null, notes: null },
  { id: 1003, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-07', is_day_off: 0, is_locked: 0,
    shift_name: 'Diurno', shift_color: '#93C5FD', start_time: '07:00', end_time: '19:00',
    duration_hours: 12, setor_override: null, notes: null },
  { id: 1004, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-08', is_day_off: 1, is_locked: 0,
    shift_name: null, shift_color: null, start_time: null, end_time: null,
    duration_hours: null, setor_override: null, notes: null },
  { id: 1005, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-09', is_day_off: 0, is_locked: 0,
    shift_name: 'Diurno', shift_color: '#93C5FD', start_time: '07:00', end_time: '19:00',
    duration_hours: 12, setor_override: null, notes: null },
  { id: 1006, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-10', is_day_off: 0, is_locked: 0,
    shift_name: 'Noturno', shift_color: '#818CF8', start_time: '19:00', end_time: '07:00',
    duration_hours: 12, setor_override: null, notes: null },
  { id: 1007, employee_id: ALEX_ID, employee_name: 'Alex', employee_color: '#6B7280',
    date: '2026-04-11', is_day_off: 1, is_locked: 0,
    shift_name: null, shift_color: null, start_time: null, end_time: null,
    duration_hours: null, setor_override: null, notes: null },
];

describe('WeekView — Alex Semana 0 Abril/2026 (validação bug #135/#136)', () => {
  it('05/04/2026 exibe label "Dom" — não "Seg" (regressão bug #135)', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    // Obtém todos os th do cabeçalho com texto "Dom"
    const domHeaders = screen.getAllByText('Dom');
    expect(domHeaders.length).toBeGreaterThan(0);

    // Verifica que o número "5" aparece no cabeçalho logo abaixo de "Dom"
    // Os th têm estrutura: <div>Dom</div><div>5</div>
    const header5 = screen.getByText('5', { selector: 'div' });
    expect(header5).toBeInTheDocument();
    // O pai do "5" deve conter "Dom" como sibling
    const headerCell = header5.parentElement;
    expect(headerCell.textContent).toContain('Dom');
    expect(headerCell.textContent).toContain('5');
  });

  it('06/04/2026 exibe label "Seg" — não "Dom" (regressão bug #135)', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    const header6 = screen.getByText('6', { selector: 'div' });
    const headerCell = header6.parentElement;
    expect(headerCell.textContent).toContain('Seg');
    expect(headerCell.textContent).not.toContain('Dom');
  });

  it('05/04 exibe turno Manhã (6h) — não FOLGA', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    // Inicial 'M' de Manhã deve estar presente
    expect(screen.getByText('M')).toBeInTheDocument();
    // Label 6h deve estar presente (turno extra)
    expect(screen.getByText('6h', { selector: 'span' })).toBeInTheDocument();
  });

  it('total mensal de Alex exibe 42h (semana 0 completa) — não 36h (regressão bug #136)', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    // 6 + 12 + 12 + 12 = 42h na coluna Total
    expect(screen.getByText('42h', { selector: 'td' })).toBeInTheDocument();
  });

  it('total de 42h tem classe text-orange-600 (42h < 160h target)', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    // 42h < 148h (160-12), fora da tolerância — exibe laranja para semana isolada
    const totalCell = screen.getByText('42h', { selector: 'td' });
    expect(totalCell).toHaveClass('text-orange-600');
  });

  it('sequência de DOW da semana está na ordem Dom→Sáb', () => {
    render(
      <WeekView
        scheduleData={makeScheduleData(alexWeek0Entries)}
        currentMonth={APR}
        currentYear={APR_YEAR}
      />
    );
    const expectedDow = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const expectedNums = ['5', '6', '7', '8', '9', '10', '11'];

    // Verifica que cada número de dia tem o DOW correto no mesmo th
    for (let i = 0; i < 7; i++) {
      const numEl = screen.getByText(expectedNums[i], { selector: 'div' });
      const cell = numEl.parentElement;
      expect(cell.textContent).toContain(expectedDow[i]);
    }
  });
});
