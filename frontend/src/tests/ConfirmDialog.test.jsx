import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  title: 'Confirmar exclusão',
  description: 'Esta ação não pode ser desfeita.',
  onConfirm: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe('ConfirmDialog — renderização', () => {
  it('exibe title e description quando open=true', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirmar exclusão')).toBeInTheDocument();
    expect(screen.getByText('Esta ação não pode ser desfeita.')).toBeInTheDocument();
  });

  it('exibe botão Cancelar', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('usa confirmLabel padrão "Confirmar"', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
  });

  it('usa confirmLabel customizado', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Excluir permanentemente" />);
    expect(screen.getByRole('button', { name: 'Excluir permanentemente' })).toBeInTheDocument();
  });

  it('não exibe conteúdo quando open=false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Confirmar exclusão')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog — variant', () => {
  it('variant="danger" aplica classe btn-danger no botão de confirmação', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" />);
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('btn-danger');
  });

  it('variant diferente de danger aplica classe btn-primary', () => {
    render(<ConfirmDialog {...defaultProps} variant="primary" />);
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('btn-primary');
  });

  it('variant padrão (não informado) usa btn-danger', () => {
    const { onOpenChange, onConfirm, ...rest } = defaultProps;
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        title="T"
        description="D"
      />
    );
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('btn-danger');
  });
});

describe('ConfirmDialog — interações', () => {
  it('clicar em confirmar chama onConfirm exatamente uma vez', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clicar em confirmar chama onOpenChange(false) para fechar o dialog', () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clicar em confirmar chama onConfirm antes de fechar', () => {
    const callOrder = [];
    const onConfirm = vi.fn(() => callOrder.push('confirm'));
    const onOpenChange = vi.fn((v) => { if (v === false) callOrder.push('close'); });
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(callOrder).toEqual(['confirm', 'close']);
  });
});
