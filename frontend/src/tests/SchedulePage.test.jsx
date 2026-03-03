/**
 * test(frontend): cobertura SchedulePage — issue #73
 *
 * Tester Senior
 *
 * Critérios de aceite:
 *   - Renderiza seletor de mês/ano
 *   - Exibe loading quando scheduleLoading=true
 *   - Exibe mensagem quando sem funcionários cadastrados
 *   - Botão "Gerar Escala" chama generateSchedule e propaga warnings
 *   - Botão "Limpar" abre ConfirmDialog; confirmar chama clearSchedule
 *
 * Estratégia: useStore mockado; componentes filhos complexos mockados;
 * ConfirmDialog real (já testado em isolamento e compatível com jsdom).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SchedulePage from '../pages/SchedulePage.jsx';
import useStore from '../store/useStore.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../store/useStore.js', () => ({ default: vi.fn() }));
vi.mock('../api/client.js', () => ({
  exportApi: { excel: vi.fn(), pdf: vi.fn() },
}));
vi.mock('../components/schedule/WeekView.jsx', () => ({
  default: vi.fn(() => <div data-testid="week-view" />),
}));
vi.mock('../components/schedule/CalendarView.jsx', () => ({
  default: () => <div data-testid="calendar-view" />,
}));
vi.mock('../components/schedule/GenerationHistory.jsx', () => ({
  default: () => null,
}));
vi.mock('../components/schedule/MonthSummary.jsx', () => ({
  default: () => null,
}));
vi.mock('../components/schedule/EntryEditPopover.jsx', () => ({
  default: () => null,
}));

// ── mockStore base ─────────────────────────────────────────────────────────────

const mockStore = {
  currentMonth: 3,
  currentYear: 2026,
  scheduleData: null,
  scheduleLoading: false,
  scheduleGenerating: false,
  employees: [{ id: 1, name: 'Ana' }],
  setCurrentPeriod: vi.fn(),
  generateSchedule: vi.fn(),
  clearSchedule: vi.fn(),
  fetchShiftTypes: vi.fn(),
  fetchEmployees: vi.fn(),
  addToast: vi.fn(),
  setWarnings: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useStore.mockReturnValue(mockStore);
  mockStore.generateSchedule.mockResolvedValue({ warnings: [], results: [] });
  mockStore.clearSchedule.mockResolvedValue();
});

// ── Seletor de mês/ano ────────────────────────────────────────────────────────

describe('SchedulePage — seletor de mês/ano', () => {
  it('exibe o mês e ano atuais no seletor de navegação', () => {
    render(<SchedulePage />);
    expect(screen.getByText('Março 2026')).toBeInTheDocument();
  });

  it('navegar para o mês anterior chama setCurrentPeriod com mês=2 ano=2026', () => {
    render(<SchedulePage />);
    // Botão com ChevronLeft — primeiro botão de navegação
    const [prevBtn] = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg')
    );
    // Usa o primeiro botão de ícone (ChevronLeft)
    const navButtons = screen.getAllByRole('button');
    // ChevronLeft é o primeiro botão com apenas SVG (sem texto)
    const chev = navButtons.find((b) => !b.textContent.trim());
    fireEvent.click(chev);
    expect(mockStore.setCurrentPeriod).toHaveBeenCalledWith(2, 2026);
  });
});

// ── Estados de carregamento ────────────────────────────────────────────────────

describe('SchedulePage — estados de carregamento', () => {
  it('exibe indicador de carregamento quando scheduleLoading=true', () => {
    useStore.mockReturnValue({ ...mockStore, scheduleLoading: true });
    render(<SchedulePage />);
    expect(screen.getByText(/Carregando escala/i)).toBeInTheDocument();
  });

  it('exibe mensagem orientando cadastro quando não há funcionários', () => {
    useStore.mockReturnValue({ ...mockStore, employees: [] });
    render(<SchedulePage />);
    expect(screen.getByText(/Cadastre funcionários/i)).toBeInTheDocument();
  });

  it('botão Gerar Escala está desabilitado quando não há funcionários', () => {
    useStore.mockReturnValue({ ...mockStore, employees: [] });
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Gerar Escala/i })).toBeDisabled();
  });

  it('renderiza WeekView quando há funcionários e scheduleLoading=false', () => {
    render(<SchedulePage />);
    expect(screen.getByTestId('week-view')).toBeInTheDocument();
  });
});

// ── Gerar Escala ──────────────────────────────────────────────────────────────

describe('SchedulePage — botão Gerar Escala', () => {
  it('chama generateSchedule diretamente quando não há escala existente', async () => {
    // scheduleData=null → hasSchedule=false → sem ConfirmDialog intermediário
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Gerar Escala/i }));
    await waitFor(() => {
      expect(mockStore.generateSchedule).toHaveBeenCalledWith(false);
    });
  });

  it('propaga warnings do resultado para setWarnings no store', async () => {
    const warnings = [{ employee: 'Ana', message: 'desvio de +14h' }];
    mockStore.generateSchedule.mockResolvedValue({ warnings, results: [{}] });
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Gerar Escala/i }));
    await waitFor(() => {
      expect(mockStore.setWarnings).toHaveBeenCalledWith(warnings);
    });
  });

  it('abre ConfirmDialog de regeração quando já há escala existente', async () => {
    useStore.mockReturnValue({
      ...mockStore,
      scheduleData: { entries: [{ id: 1 }] },
    });
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Gerar Escala/i }));
    await waitFor(() => {
      expect(screen.getByText('Regerar escala')).toBeInTheDocument();
    });
  });

  it('confirmar regeração chama generateSchedule', async () => {
    useStore.mockReturnValue({
      ...mockStore,
      scheduleData: { entries: [{ id: 1 }] },
    });
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Gerar Escala/i }));
    await waitFor(() => screen.getByRole('button', { name: /Regerar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Regerar/i }));
    await waitFor(() => {
      expect(mockStore.generateSchedule).toHaveBeenCalledWith(false);
    });
  });
});

// ── Limpar Escala ─────────────────────────────────────────────────────────────

describe('SchedulePage — botão Limpar', () => {
  const storeComEscala = () =>
    useStore.mockReturnValue({ ...mockStore, scheduleData: { entries: [{ id: 1 }] } });

  it('botão Limpar não é exibido quando não há escala', () => {
    render(<SchedulePage />);
    expect(screen.queryByRole('button', { name: /Limpar/i })).not.toBeInTheDocument();
  });

  it('botão Limpar é exibido quando há escala existente', () => {
    storeComEscala();
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Limpar/i })).toBeInTheDocument();
  });

  it('clique em Limpar abre ConfirmDialog de confirmação', async () => {
    storeComEscala();
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Limpar/i }));
    await waitFor(() => {
      expect(screen.getByText('Limpar escala')).toBeInTheDocument();
    });
  });

  it('confirmar diálogo de limpar chama clearSchedule', async () => {
    storeComEscala();
    render(<SchedulePage />);
    fireEvent.click(screen.getByRole('button', { name: /Limpar/i }));
    await waitFor(() => screen.getByRole('button', { name: /Limpar tudo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Limpar tudo/i }));
    await waitFor(() => {
      expect(mockStore.clearSchedule).toHaveBeenCalled();
    });
  });
});
