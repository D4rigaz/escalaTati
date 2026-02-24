import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmployeeForm from '../components/employees/EmployeeForm.jsx';
import useStore from '../store/useStore.js';

vi.mock('../store/useStore.js', () => ({ default: vi.fn() }));

const mockStore = {
  shiftTypes: [],
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  createVacation: vi.fn(),
  deleteVacation: vi.fn(),
  addToast: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useStore.mockReturnValue(mockStore);
  mockStore.createEmployee.mockResolvedValue({ id: 99, name: 'Novo' });
  mockStore.updateEmployee.mockResolvedValue({ id: 1, name: 'Atualizado' });
  mockStore.createVacation.mockResolvedValue({ id: 10, start_date: '2025-01-01', end_date: '2025-01-07' });
  mockStore.deleteVacation.mockResolvedValue({});
});

const openProps = { open: true, onOpenChange: vi.fn(), onSuccess: vi.fn() };

// ─── Renderização ─────────────────────────────────────────────────────────────

describe('EmployeeForm — renderização', () => {
  it('exibe "Novo Funcionário" no modo criação (sem employee prop)', () => {
    render(<EmployeeForm {...openProps} />);
    expect(screen.getByText('Novo Funcionário')).toBeInTheDocument();
  });

  it('exibe "Editar Funcionário" no modo edição (com employee prop)', () => {
    const employee = { id: 1, name: 'Ana', setores: ['Transporte Ambulância'], vacations: [] };
    render(<EmployeeForm {...openProps} employee={employee} />);
    expect(screen.getByText('Editar Funcionário')).toBeInTheDocument();
  });

  it('botão submit exibe "Criar" no modo criação', () => {
    render(<EmployeeForm {...openProps} />);
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument();
  });

  it('botão submit exibe "Salvar" no modo edição', () => {
    const employee = { id: 1, name: 'Ana', setores: ['Transporte Ambulância'], vacations: [] };
    render(<EmployeeForm {...openProps} employee={employee} />);
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('seção Férias visível apenas no modo edição', () => {
    const employee = { id: 1, name: 'Ana', setores: ['Transporte Ambulância'], vacations: [] };
    const { rerender } = render(<EmployeeForm {...openProps} />);
    expect(screen.queryByText('Férias')).not.toBeInTheDocument();

    rerender(<EmployeeForm {...openProps} employee={employee} />);
    expect(screen.getByText('Férias')).toBeInTheDocument();
  });

  it('cargo exibido como texto fixo "Motorista"', () => {
    render(<EmployeeForm {...openProps} />);
    expect(screen.getByText('Motorista')).toBeInTheDocument();
  });

  it('descanso mínimo exibido como texto fixo "24h"', () => {
    render(<EmployeeForm {...openProps} />);
    expect(screen.getByText('24h')).toBeInTheDocument();
  });

  it('não exibe conteúdo quando open=false', () => {
    render(<EmployeeForm open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Novo Funcionário')).not.toBeInTheDocument();
  });
});

// ─── toggleSetor — lógica de exclusividade ADM ────────────────────────────────

describe('EmployeeForm — toggleSetor', () => {
  it('selecionar Ambulância marca apenas Ambulância', () => {
    render(<EmployeeForm {...openProps} />);
    const cbAmbul = screen.getByRole('checkbox', { name: /Ambulância/ });
    fireEvent.click(cbAmbul);
    expect(cbAmbul).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hemodiálise/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Administrativo/ })).not.toBeChecked();
  });

  it('selecionar Ambulância + Hemodiálise → ambos marcados simultaneamente', () => {
    render(<EmployeeForm {...openProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ambulância/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Hemodiálise/ }));
    expect(screen.getByRole('checkbox', { name: /Ambulância/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hemodiálise/ })).toBeChecked();
  });

  it('desselecionar Ambulância já marcada remove a seleção', () => {
    render(<EmployeeForm {...openProps} />);
    const cb = screen.getByRole('checkbox', { name: /Ambulância/ });
    fireEvent.click(cb);
    fireEvent.click(cb);
    expect(cb).not.toBeChecked();
  });

  it('selecionar ADM quando Ambulância está marcada: ADM fica marcado, Ambulância desmarcada', () => {
    render(<EmployeeForm {...openProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ambulância/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Administrativo/ }));
    expect(screen.getByRole('checkbox', { name: /Administrativo/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Ambulância/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hemodiálise/ })).not.toBeChecked();
  });

  it('selecionar ADM quando nada está marcado: ADM fica marcado', () => {
    render(<EmployeeForm {...openProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Administrativo/ }));
    expect(screen.getByRole('checkbox', { name: /Administrativo/ })).toBeChecked();
  });

  it('desselecionar ADM quando ADM está marcado: todos ficam desmarcados', () => {
    render(<EmployeeForm {...openProps} />);
    const cbAdm = screen.getByRole('checkbox', { name: /Administrativo/ });
    fireEvent.click(cbAdm); // seleciona
    fireEvent.click(cbAdm); // desseleciona
    expect(cbAdm).not.toBeChecked();
  });

  it('checkboxes de Ambulância e Hemodiálise ficam disabled quando ADM está selecionado', () => {
    render(<EmployeeForm {...openProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Administrativo/ }));
    expect(screen.getByRole('checkbox', { name: /Ambulância/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Hemodiálise/ })).toBeDisabled();
  });

  it('checkboxes de Ambulância e Hemodiálise ficam enabled quando ADM é desselecionado', () => {
    render(<EmployeeForm {...openProps} />);
    const cbAdm = screen.getByRole('checkbox', { name: /Administrativo/ });
    fireEvent.click(cbAdm);
    fireEvent.click(cbAdm);
    expect(screen.getByRole('checkbox', { name: /Ambulância/ })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Hemodiálise/ })).not.toBeDisabled();
  });

  it('aviso de setor obrigatório exibido quando nenhum setor está selecionado', () => {
    render(<EmployeeForm {...openProps} />);
    expect(screen.getByText('Selecione pelo menos um setor')).toBeInTheDocument();
  });

  it('aviso de setor obrigatório some após selecionar um setor', () => {
    render(<EmployeeForm {...openProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ambulância/ }));
    expect(screen.queryByText('Selecione pelo menos um setor')).not.toBeInTheDocument();
  });
});

// ─── Submit — validação e payload ────────────────────────────────────────────

describe('EmployeeForm — submit', () => {
  it('submit sem setores exibe toast de erro e não chama createEmployee', async () => {
    const user = userEvent.setup();
    render(<EmployeeForm {...openProps} />);

    await user.type(screen.getByPlaceholderText('Nome completo'), 'João');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(mockStore.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
    expect(mockStore.createEmployee).not.toHaveBeenCalled();
  });

  it('submit sem nome exibe mensagem de validação do campo', async () => {
    const user = userEvent.setup();
    render(<EmployeeForm {...openProps} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Ambulância/ }));
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(await screen.findByText('Nome é obrigatório')).toBeInTheDocument();
    expect(mockStore.createEmployee).not.toHaveBeenCalled();
  });

  it('submit válido em modo criação chama createEmployee com payload correto', async () => {
    const user = userEvent.setup();
    render(<EmployeeForm {...openProps} />);

    await user.type(screen.getByPlaceholderText('Nome completo'), 'Maria');
    fireEvent.click(screen.getByRole('checkbox', { name: /Ambulância/ }));
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => {
      expect(mockStore.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Maria',
          cargo: 'Motorista',
          setores: ['Transporte Ambulância'],
        })
      );
    });
  });

  it('submit válido em modo edição chama updateEmployee com id correto', async () => {
    const user = userEvent.setup();
    const employee = {
      id: 5,
      name: 'Carlos',
      setores: ['Transporte Hemodiálise'],
      vacations: [],
      work_schedule: 'dom_sab',
      color: '#6B7280',
    };
    render(<EmployeeForm {...openProps} employee={employee} />);

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockStore.updateEmployee).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ name: 'Carlos', cargo: 'Motorista' })
      );
    });
  });

  it('submit com ADM inclui apenas ADM no payload de setores', async () => {
    const user = userEvent.setup();
    render(<EmployeeForm {...openProps} />);

    await user.type(screen.getByPlaceholderText('Nome completo'), 'Diretor');
    fireEvent.click(screen.getByRole('checkbox', { name: /Administrativo/ }));
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => {
      expect(mockStore.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ setores: ['Transporte Administrativo'] })
      );
    });
  });
});
