import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import useStore from '../../store/useStore.js';

const SETORES = [
  'Transporte Ambulância',
  'Transporte Hemodiálise',
  'Transporte Administrativo',
];

export default function EmployeeForm({ open, onOpenChange, employee, onSuccess }) {
  const { shiftTypes, createEmployee, updateEmployee, addToast } = useStore();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: employee
      ? {
          name: employee.name,
          setor: employee.setor,
          days_off_per_week: employee.restRules?.days_off_per_week ?? 1,
          preferred_shift_id: employee.restRules?.preferred_shift_id ?? '',
          notes: employee.restRules?.notes ?? '',
        }
      : {
          setor: '',
          days_off_per_week: 1,
          preferred_shift_id: '',
          notes: '',
        },
  });

  useEffect(() => {
    if (open) {
      reset(
        employee
          ? {
              name: employee.name,
              setor: employee.setor,
              days_off_per_week: employee.restRules?.days_off_per_week ?? 1,
              preferred_shift_id: employee.restRules?.preferred_shift_id ?? '',
              notes: employee.restRules?.notes ?? '',
            }
          : { setor: '', days_off_per_week: 1, preferred_shift_id: '', notes: '' }
      );
    }
  }, [open, employee]);

  const onSubmit = async (data) => {
    try {
      const payload = {
        name: data.name,
        cargo: 'Motorista',
        setor: data.setor,
        restRules: {
          days_off_per_week: parseInt(data.days_off_per_week),
          preferred_shift_id: data.preferred_shift_id ? parseInt(data.preferred_shift_id) : null,
          notes: data.notes || null,
        },
      };

      if (employee) {
        await updateEmployee(employee.id, payload);
        addToast({ type: 'success', title: 'Funcionário atualizado', message: data.name });
      } else {
        await createEmployee(payload);
        addToast({ type: 'success', title: 'Funcionário criado', message: data.name });
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      addToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-bold text-gray-900">
              {employee ? 'Editar Funcionário' : 'Novo Funcionário'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Basic info */}
            <div>
              <label className="label">Nome *</label>
              <input
                className="input"
                {...register('name', { required: 'Nome é obrigatório' })}
                placeholder="Nome completo"
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cargo</label>
                <p className="text-sm text-gray-500 mt-1 px-1">
                  <strong>Motorista</strong>
                </p>
              </div>
              <div>
                <label className="label">Setor *</label>
                <select
                  className="input"
                  {...register('setor', { required: 'Setor é obrigatório' })}
                >
                  <option value="">Selecione o setor</option>
                  {SETORES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errors.setor && (
                  <p className="text-xs text-red-500 mt-1">{errors.setor.message}</p>
                )}
              </div>
            </div>

            {/* Rest rules */}
            <div className="border-t pt-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Regras de Descanso</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Descanso mínimo</label>
                  <p className="text-sm text-gray-500 mt-1 px-1">
                    <strong>24h</strong> (fixo)
                  </p>
                </div>
                <div>
                  <label className="label">Folgas por semana</label>
                  <input
                    type="number"
                    className="input"
                    min="0"
                    max="4"
                    {...register('days_off_per_week', { min: 0, max: 4 })}
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="label">Turno preferencial</label>
                <select className="input" {...register('preferred_shift_id')}>
                  <option value="">Sem preferência</option>
                  {shiftTypes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.start_time}–{s.end_time})
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3">
                <label className="label">Observações</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  {...register('notes')}
                  placeholder="Opcional..."
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary">
                  Cancelar
                </button>
              </Dialog.Close>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : employee ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
