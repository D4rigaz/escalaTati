import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationBell from '../components/layout/NotificationBell.jsx';
import useStore from '../store/useStore.js';

vi.mock('../store/useStore.js', () => ({ default: vi.fn() }));

function setup(warnings = [], clearWarnings = vi.fn()) {
  useStore.mockReturnValue({ warnings, clearWarnings });
  return render(<NotificationBell />);
}

beforeEach(() => vi.clearAllMocks());

// ─── Badge ────────────────────────────────────────────────────────────────────

describe('NotificationBell — badge', () => {
  it('sem warnings: badge não é renderizado', () => {
    setup([]);
    const btn = screen.getByRole('button', { name: 'Notificações' });
    // Badge span only exists when count > 0; Bell icon (SVG) has no spans
    expect(btn.querySelector('span')).toBeNull();
  });

  it('1 warning: badge exibe "1"', () => {
    setup([{ message: 'Aviso' }]);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('9 warnings: badge exibe "9"', () => {
    setup(Array.from({ length: 9 }, (_, i) => ({ message: `Aviso ${i + 1}` })));
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('10 warnings: badge exibe "9+" (cap)', () => {
    setup(Array.from({ length: 10 }, (_, i) => ({ message: `Aviso ${i + 1}` })));
    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});

// ─── Acessibilidade ───────────────────────────────────────────────────────────

describe('NotificationBell — acessibilidade', () => {
  it('botão trigger tem aria-label="Notificações"', () => {
    setup([]);
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });
});

// ─── Popover conteúdo ─────────────────────────────────────────────────────────

describe('NotificationBell — popover conteúdo', () => {
  it('sem warnings: abre popover com "Nenhum aviso"', () => {
    setup([]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Nenhum aviso')).toBeInTheDocument();
  });

  it('com warnings: popover exibe mensagem de cada aviso', () => {
    setup([{ message: 'Turno sem cobertura' }, { message: 'Horas insuficientes' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Turno sem cobertura')).toBeInTheDocument();
    expect(screen.getByText('Horas insuficientes')).toBeInTheDocument();
  });

  it('warning com date: exibe mensagem e data', () => {
    setup([{ message: 'Aviso com data', date: '2025-03-10' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Aviso com data')).toBeInTheDocument();
    expect(screen.getByText('2025-03-10')).toBeInTheDocument();
  });

  it('warning sem date: não exibe campo de data', () => {
    setup([{ message: 'Aviso sem data' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Aviso sem data')).toBeInTheDocument();
    expect(screen.queryByText(/^\d{4}-\d{2}-\d{2}$/)).not.toBeInTheDocument();
  });
});

// ─── "Limpar tudo" ────────────────────────────────────────────────────────────

describe('NotificationBell — "Limpar tudo"', () => {
  it('sem warnings: botão "Limpar tudo" não aparece', () => {
    setup([]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.queryByRole('button', { name: 'Limpar tudo' })).not.toBeInTheDocument();
  });

  it('com warnings: botão "Limpar tudo" aparece no popover', () => {
    setup([{ message: 'Aviso' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByRole('button', { name: 'Limpar tudo' })).toBeInTheDocument();
  });

  it('"Limpar tudo" chama clearWarnings ao ser clicado', () => {
    const clearWarnings = vi.fn();
    setup([{ message: 'Aviso' }], clearWarnings);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar tudo' }));
    expect(clearWarnings).toHaveBeenCalledOnce();
  });

  it('re-render com warnings=[]: exibe "Nenhum aviso" e badge some', () => {
    const clearWarnings = vi.fn();
    useStore.mockReturnValue({ warnings: [{ message: 'Aviso' }], clearWarnings });
    const { rerender } = render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar tudo' }));

    // Simula o store sendo atualizado após clearWarnings
    useStore.mockReturnValue({ warnings: [], clearWarnings });
    rerender(<NotificationBell />);

    expect(screen.getByText('Nenhum aviso')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Notificações' });
    expect(btn.querySelector('span')).toBeNull();
  });
});
