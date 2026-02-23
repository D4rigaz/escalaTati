import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, Trash2 } from 'lucide-react';
import useStore from '../../store/useStore.js';

const SETORES = [
  'Transporte Ambulância',
  'Transporte Hemodiálise',
  'Transporte Administrativo',
];

const SETOR_ADM = 'Transporte Administrativo';

export default function EmployeeForm({ open, onOpenChange, employee, onSuccess }) {
  const {
    shiftTypes,
    createEmployee,
    updateEmployee,
    createVacation,
    deleteVacation,
    addToast,
  } = useStore();

  const isEdit = Boolean(employee);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      name: '',
      work_schedule: 'dom_sab',
      color: '#6B7280',
      preferred_shift_id: '',
      notes: '',
    },
  });

  const [selectedSetores, setSelectedSetores] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [newVac, setNewVac] = useState({ start_date: '', end_date: '', notes: '' });
  const [addingVac, setAddingVac] = useState(false);

  useEffect(() => {
    if (open) {
      reset({
        name: employee?.name ?? '',
        work_schedule: employee?.work_schedule ?? 'dom_sab',
        color: employee?.color ?? '#6B7280',
        preferred_shift_id: employee?.restRules?.preferred_shift_id ?? '',
        notes: employee?.restRules?.notes ?? '',
      });
      setSelectedSetores(employee?.setores ?? []);
      setVacations(employee?.vacations ?? []);
      setNewVac({ start_date: '', end_date: '', notes: '' });
      setAddingVac(false);
    }
  }, [open, employee]);

  const toggleSetor = (setor) => {
    if (setor === SETOR_ADM) {
      setSelectedSetores((prev) =>
        prev.includes(SETOR_ADM) ? [] : [SETOR_ADM]
      );
    } else {
      setSelectedSetores((prev) => {
        const withoutAdm = prev.filter((s) => s !== SETOR_ADM);
        if (withoutAdm.includes(setor)) return withoutAdm.filter((s) => s !== setor);
        return [...withoutAdm, setor];
      });
    }
  };

  const handleAddVacation = async () => {
    if (!newVac.start_date || !newVac.end_date) return;
    setAddingVac(true);
    try {
      const created = await createVacation(employee.id, newVac);
      setVacations((v) => [...v, created]);
      setNewVac({ start_date: '', end_date: '', notes: '' });
      addToast({ type: 'success', title: 'Férias adicionadas' });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro ao adicionar férias', message: err.message });
    } finally {
      setAddingVac(false);
    }
  };

  const handleDeleteVacation = async (vid) => {
    try {
      await deleteVacation(employee.id, vid);
      setVacations((v) => v.filter((x) => x.id !== vid));
      addToast({ type: 'success', title: 'Férias removidas' });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro ao remover férias', message: err.message });
    }
  };

  const onSubmit = async (data) => {
    if (selectedSetores.length === 0) {
      addToast({ type: 'error', title: 'Selecione pelo menos um setor' });
      return;
    }
    try {
      const payload = {
        name: data.name,
        cargo: 'Motorista',
        setores: selectedSetores,
        work_schedule: data.work_schedule,
        color: data.color,
        restRules: {
          preferred_shift_id: data.preferred_shift_id ? parseInt(data.preferred_shift_id) : null,
          notes: data.notes || null,
        },
      };

      if (isEdit) {
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
              {isEdit ? 'Editar Funcionário' : 'Novo Funcionário'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Nome + Cor */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <label className="label">Nome *</label>
                <input
                  className="input"
                  {...register('name', { required: 'Nome é obrigatório' })}
                  placeholder="Nome completo"
                />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="label">Cor</label>
                <input
                  type="color"
                  className="h-9 w-12 rounded border border-gray-200 cursor-pointer p-0.5"
                  {...register('color')}
                />
              </div>
            </div>

            {/* Cargo + Semana de trabalho */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cargo</label>
                <p className="text-sm text-gray-500 mt-1 px-1">
                  <strong>Motorista</strong>
                </p>
              </div>
              <div>
                <label className="label">Semana de trabalho</label>
                <select className="input" {...register('work_schedule')}>
                  <option value="dom_sab">Domingo a Sábado</option>
                  <option value="seg_sex">Segunda a Sexta</option>
                </select>
              </div>
            </div>

            {/* Setores */}
            <div>
              <label className="label">Setores *</label>
              <div className="flex flex-col gap-2 mt-1">
                {SETORES.map((setor) => {
                  const isAdm = setor === SETOR_ADM;
                  const isChecked = selectedSetores.includes(setor);
                  const isDisabled = !isAdm && selectedSetores.includes(SETOR_ADM);
                  return (
                    <label
                      key={setor}
                      className={`flex items-center gap-2 cursor-pointer text-sm ${isDisabled ? 'opacity-40' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={() => toggleSetor(setor)}
                      />
                      {setor}
                      {isAdm && (
                        <span className="text-xs text-gray-400">(exclusivo)</span>
                      )}
                    </label>
                  );
                })}
              </div>
              {selectedSetores.length === 0 && (
                <p className="text-xs text-red-500 mt-1">Selecione pelo menos um setor</p>
              )}
            </div>

            {/* Regras de Descanso */}
            <div className="border-t pt-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Regras de Descanso</p>
              <div className="mb-3">
                <label className="label">Descanso mínimo</label>
                <p className="text-sm text-gray-500 mt-1 px-1">
                  <strong>24h</strong> (fixo)
                </p>
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

            {/* Férias (somente no modo editar) */}
            {isEdit && (
              <div className="border-t pt-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Férias</p>

                {vacations.length > 0 && (
                  <ul className="space-y-1.5 mb-3">
                    {vacations.map((v) => (
                      <li key={v.id} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-1.5 text-xs">
                        <span className="text-blue-800">
                          {v.start_date} → {v.end_date}
                          {v.notes && <span className="text-gray-500 ml-2">({v.notes})</span>}
                        </span>
                        <button
                          type="button"
                          className="text-red-400 hover:text-red-600 ml-2"
                          onClick={() => handleDeleteVacation(v.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <div>
                    <label className="label">Início</label>
                    <input
                      type="date"
                      className="input text-xs"
                      value={newVac.start_date}
                      onChange={(e) => setNewVac((v) => ({ ...v, start_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Fim</label>
                    <input
                      type="date"
                      className="input text-xs"
                      value={newVac.end_date}
                      onChange={(e) => setNewVac((v) => ({ ...v, end_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Obs.</label>
                    <input
                      className="input text-xs"
                      placeholder="Opcional"
                      value={newVac.notes}
                      onChange={(e) => setNewVac((v) => ({ ...v, notes: e.target.value }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs h-9 px-2"
                    disabled={!newVac.start_date || !newVac.end_date || addingVac}
                    onClick={handleAddVacation}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary">
                  Cancelar
                </button>
              </Dialog.Close>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
