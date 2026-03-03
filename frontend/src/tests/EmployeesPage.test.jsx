/**
 * test(frontend): cobertura EmployeesPage — issue #74
 *
 * Desenvolvedor Pleno
 *
 * Critérios de aceite:
 *   - Input de busca por nome filtra a lista em tempo real
 *   - Dropdown de setor filtra por `setores` do motorista
 *   - Combinação nome + setor aplica ambos os filtros simultaneamente
 *   - Resultado vazio exibe mensagem descritiva
 *   - Filtros não disparam requests ao backend
 *   - Botão "Limpar filtros" restaura a lista completa
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmployeesPage from '../pages/EmployeesPage.jsx';
import useStore from '../store/useStore.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../store/useStore.js', () => ({ default: vi.fn() }));
vi.mock('../api/client.js', () => ({
  employeesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  shiftTypesApi: { list: vi.fn() },
}));
vi.mock('../components/employees/EmployeeCard.jsx', () => ({
  default: ({ employee }) => <div data-testid="employee-card">{employee.name}</div>,
}));
vi.mock('../components/employees/EmployeeForm.jsx', () => ({
  default: () => null,
}));
vi.mock('../components/shared/ConfirmDialog.jsx', () => ({
  default: () => null,
}));

// ── Dados de teste ────────────────────────────────────────────────────────────

const EMPLOYEES = [
  { id: 1, name: 'Ana',   cargo: 'Motorista', setores: ['Transporte Ambulância'],  color: '#aaa' },
  { id: 2, name: 'Bruno', cargo: 'Motorista', setores: ['Transporte Hemodiálise'], color: '#bbb' },
  { id: 3, name: 'Cida',  cargo: 'Motorista', setores: ['Transporte Ambulância'],  color: '#ccc' },
];

const mockStore = {
  employees: EMPLOYEES,
  employeesLoading: false,
  fetchEmployees: vi.fn(),
  deleteEmployee: vi.fn(),
  shiftTypes: [],
  fetchShiftTypes: vi.fn(),
  addToast: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useStore.mockReturnValue({ ...mockStore, employees: EMPLOYEES });
});

// ── Renderização base ─────────────────────────────────────────────────────────

describe('EmployeesPage — renderização base', () => {
  it('exibe todos os motoristas sem filtro ativo', () => {
    render(<EmployeesPage />);
    expect(screen.getAllByTestId('employee-card')).toHaveLength(3);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Cida')).toBeInTheDocument();
  });

  it('exibe campo de busca por nome e dropdown de setor', () => {
    render(<EmployeesPage />);
    expect(screen.getByPlaceholderText('Buscar por nome...')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Filtrar por setor/i })).toBeInTheDocument();
  });

  it('botão "Limpar filtros" não é exibido quando não há filtros ativos', () => {
    render(<EmployeesPage />);
    expect(screen.queryByRole('button', { name: /Limpar filtros/i })).not.toBeInTheDocument();
  });

  it('sem motoristas cadastrados exibe "Nenhum motorista cadastrado"', () => {
    useStore.mockReturnValue({ ...mockStore, employees: [] });
    render(<EmployeesPage />);
    expect(screen.getByText('Nenhum motorista cadastrado')).toBeInTheDocument();
  });
});

// ── Busca por nome ────────────────────────────────────────────────────────────

describe('EmployeesPage — busca por nome', () => {
  it('filtra motoristas pelo nome em tempo real', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(1);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('filtragem por nome é case-insensitive', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'ana' } });
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('busca por substring retorna todos os matches', () => {
    render(<EmployeesPage />);
    // 'a' aparece em 'Ana' e 'Cida'
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'a' } });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(2);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Cida')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('busca sem resultado exibe mensagem descritiva com menção a filtros', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'XYZXYZ' } });
    expect(screen.getByText('Nenhum motorista encontrado para os filtros aplicados')).toBeInTheDocument();
  });

  it('busca por nome não dispara requests ao backend (fetchEmployees chamado apenas no mount)', () => {
    render(<EmployeesPage />);
    const callsBefore = mockStore.fetchEmployees.mock.calls.length;
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    expect(mockStore.fetchEmployees.mock.calls.length).toBe(callsBefore);
  });
});

// ── Filtro por setor ──────────────────────────────────────────────────────────

describe('EmployeesPage — filtro por setor', () => {
  it('selecionar "Transporte Ambulância" exibe somente motoristas desse setor', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Ambulância' },
    });
    // Ana e Cida são de Ambulância; Bruno de Hemodiálise
    expect(screen.getAllByTestId('employee-card')).toHaveLength(2);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Cida')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('selecionar "Transporte Hemodiálise" exibe somente Bruno', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Hemodiálise' },
    });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(1);
    expect(screen.getByText('Bruno')).toBeInTheDocument();
  });

  it('filtro de setor sem resultado exibe mensagem descritiva', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Administrativo' },
    });
    expect(screen.getByText('Nenhum motorista encontrado para os filtros aplicados')).toBeInTheDocument();
  });

  it('selecionar "Todos os setores" restaura lista completa', () => {
    render(<EmployeesPage />);
    const select = screen.getByRole('combobox', { name: /Filtrar por setor/i });
    fireEvent.change(select, { target: { value: 'Transporte Hemodiálise' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(3);
  });
});

// ── Combinação de filtros ─────────────────────────────────────────────────────

describe('EmployeesPage — combinação nome + setor (AND)', () => {
  it('nome "Ana" + setor "Transporte Ambulância" retorna somente Ana', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Ambulância' },
    });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(1);
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('nome "Ana" + setor "Transporte Hemodiálise" retorna resultado vazio', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Hemodiálise' },
    });
    expect(screen.getByText('Nenhum motorista encontrado para os filtros aplicados')).toBeInTheDocument();
  });
});

// ── Limpar filtros ────────────────────────────────────────────────────────────

describe('EmployeesPage — botão Limpar filtros', () => {
  it('botão aparece quando busca por nome está ativa', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    expect(screen.getByRole('button', { name: /Limpar filtros/i })).toBeInTheDocument();
  });

  it('botão aparece quando filtro de setor está ativo', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Ambulância' },
    });
    expect(screen.getByRole('button', { name: /Limpar filtros/i })).toBeInTheDocument();
  });

  it('clicar em "Limpar filtros" restaura a lista completa', () => {
    render(<EmployeesPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome...'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Filtrar por setor/i }), {
      target: { value: 'Transporte Ambulância' },
    });
    expect(screen.getAllByTestId('employee-card')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/i }));
    expect(screen.getAllByTestId('employee-card')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Limpar filtros/i })).not.toBeInTheDocument();
  });
});
