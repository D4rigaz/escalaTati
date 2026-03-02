import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GenerationHistory from '../components/schedule/GenerationHistory.jsx';
import { schedulesApi } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  schedulesApi: { getGenerations: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

const MONTH = 3;
const YEAR = 2026;

function makeGen(overrides = {}) {
  return {
    id: 1,
    month: MONTH,
    year: YEAR,
    generated_at: '2026-03-02T21:00:00.000Z',
    params_json: { warnings: [], weekClassifications: [] },
    ...overrides,
  };
}

// ── Estado vazio ───────────────────────────────────────────────────────────────

describe('GenerationHistory — estado vazio', () => {
  it('exibe "Nenhuma geração registrada" quando a lista está vazia', async () => {
    schedulesApi.getGenerations.mockResolvedValue([]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() =>
      expect(screen.getByText(/Nenhuma geração registrada para este período/i)).toBeInTheDocument()
    );
  });

  it('exibe "Carregando..." enquanto aguarda a resposta', () => {
    schedulesApi.getGenerations.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });

  it('exibe "Nenhuma geração" quando a API falha', async () => {
    schedulesApi.getGenerations.mockRejectedValue(new Error('Network error'));
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() =>
      expect(screen.getByText(/Nenhuma geração registrada para este período/i)).toBeInTheDocument()
    );
  });
});

// ── Lista de gerações ──────────────────────────────────────────────────────────

describe('GenerationHistory — lista', () => {
  it('exibe a data/hora formatada de cada geração', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ generated_at: '2026-03-02T21:30:00.000Z' }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    // formato dd/mm hh:mm (horário local — valor exato depende do fuso)
    await waitFor(() =>
      expect(screen.getByText(/\d{2}\/\d{2} \d{2}:\d{2}/)).toBeInTheDocument()
    );
  });

  it('exibe "Sem avisos" quando warnings está vazio', async () => {
    schedulesApi.getGenerations.mockResolvedValue([makeGen()]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() =>
      expect(screen.getByText('Sem avisos')).toBeInTheDocument()
    );
  });

  it('exibe contagem de avisos quando há warnings', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ params_json: { warnings: [{ message: 'Aviso A' }, { message: 'Aviso B' }] } }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() =>
      expect(screen.getByText('2 avisos')).toBeInTheDocument()
    );
  });

  it('exibe "1 aviso" (singular) quando há exatamente 1 warning', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ params_json: { warnings: [{ message: 'Único aviso' }] } }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() =>
      expect(screen.getByText('1 aviso')).toBeInTheDocument()
    );
  });

  it('chama getGenerations com month e year corretos', async () => {
    schedulesApi.getGenerations.mockResolvedValue([]);
    render(<GenerationHistory month={5} year={2026} />);
    await waitFor(() => expect(schedulesApi.getGenerations).toHaveBeenCalledWith(5, 2026));
  });
});

// ── Expansão de item ───────────────────────────────────────────────────────────

describe('GenerationHistory — expansão', () => {
  it('conteúdo detalhado não aparece antes de expandir', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ params_json: { warnings: [{ message: 'Aviso X' }] } }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() => expect(screen.getByText('1 aviso')).toBeInTheDocument());
    expect(screen.queryByText('• Aviso X')).not.toBeInTheDocument();
  });

  it('expande item ao clicar e exibe warnings', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ params_json: { warnings: [{ message: 'Cobertura insuficiente' }] } }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() => expect(screen.getByText('1 aviso')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('• Cobertura insuficiente')).toBeInTheDocument();
  });

  it('warning com date exibe a data entre parênteses', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({
        params_json: { warnings: [{ message: 'Plantão descoberto', date: '2026-03-15' }] },
      }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() => expect(screen.getByText('1 aviso')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('• Plantão descoberto')).toBeInTheDocument();
    expect(screen.getByText('(2026-03-15)')).toBeInTheDocument();
  });

  it('sem warnings expandido: exibe "Nenhum aviso nesta geração"', async () => {
    schedulesApi.getGenerations.mockResolvedValue([makeGen()]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() => expect(screen.getByText('Sem avisos')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Nenhum aviso nesta geração.')).toBeInTheDocument();
  });

  it('colapsa item ao clicar novamente', async () => {
    schedulesApi.getGenerations.mockResolvedValue([
      makeGen({ params_json: { warnings: [{ message: 'Aviso Y' }] } }),
    ]);
    render(<GenerationHistory month={MONTH} year={YEAR} />);
    await waitFor(() => expect(screen.getByText('1 aviso')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('• Aviso Y')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('• Aviso Y')).not.toBeInTheDocument();
  });

  it('re-fetch ao mudar month/year e reseta expansão', async () => {
    schedulesApi.getGenerations.mockResolvedValue([makeGen()]);
    const { rerender } = render(<GenerationHistory month={3} year={2026} />);
    await waitFor(() => expect(screen.getByText('Sem avisos')).toBeInTheDocument());

    schedulesApi.getGenerations.mockResolvedValue([]);
    rerender(<GenerationHistory month={4} year={2026} />);
    await waitFor(() =>
      expect(screen.getByText(/Nenhuma geração registrada/i)).toBeInTheDocument()
    );
    expect(schedulesApi.getGenerations).toHaveBeenCalledWith(4, 2026);
  });
});
