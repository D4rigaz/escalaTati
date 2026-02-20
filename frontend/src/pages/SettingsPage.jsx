import { useEffect, useState } from 'react';
import { Save, Trash2, Plus, X } from 'lucide-react';
import useStore from '../store/useStore.js';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';

const EMPTY_FORM = { name: '', start_time: '08:00', end_time: '14:00', duration_hours: 6, color: '#6EE7B7' };

function ShiftTypeEditor({ shift, onSave, onDelete }) {
  const [form, setForm] = useState({ ...shift });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleChange = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(shift.id, form);
    } finally {
      setSaving(false);
    }
  };

  const isChanged = JSON.stringify(form) !== JSON.stringify(shift);

  return (
    <>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shrink-0 border border-gray-300"
              style={{ backgroundColor: form.color }}
            />
            <input
              className="input font-semibold text-gray-900 py-1"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Nome do turno"
            />
          </div>
          <button
            className="btn-ghost text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5"
            onClick={() => setConfirmDelete(true)}
            title="Excluir turno"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="label">Início</label>
            <input
              type="time"
              className="input"
              value={form.start_time}
              onChange={(e) => handleChange('start_time', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Fim</label>
            <input
              type="time"
              className="input"
              value={form.end_time}
              onChange={(e) => handleChange('end_time', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Duração (horas)</label>
            <input
              type="number"
              className="input"
              min="1"
              max="24"
              value={form.duration_hours}
              onChange={(e) => handleChange('duration_hours', parseInt(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Cor</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                className="h-9 w-16 cursor-pointer rounded border border-gray-300"
                value={form.color}
                onChange={(e) => handleChange('color', e.target.value)}
              />
              <span className="text-sm text-gray-500">{form.color}</span>
            </div>
          </div>
        </div>

        {isChanged && (
          <button className="btn-primary w-full mt-2" onClick={handleSave} disabled={saving}>
            <Save size={15} />
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir turno"
        description={`Tem certeza que deseja excluir o turno "${shift.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={() => onDelete(shift.id)}
      />
    </>
  );
}

function NewShiftForm({ onCreate, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const handleChange = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onCreate(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5 border-2 border-dashed border-blue-300 bg-blue-50/40">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Novo Turno</h3>
        <button className="btn-ghost p-1.5 text-gray-400" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div className="mb-3">
        <label className="label">Nome</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Ex: Intermediário"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label">Início</label>
          <input
            type="time"
            className="input"
            value={form.start_time}
            onChange={(e) => handleChange('start_time', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Fim</label>
          <input
            type="time"
            className="input"
            value={form.end_time}
            onChange={(e) => handleChange('end_time', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Duração (horas)</label>
          <input
            type="number"
            className="input"
            min="1"
            max="24"
            value={form.duration_hours}
            onChange={(e) => handleChange('duration_hours', parseInt(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Cor</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              className="h-9 w-16 cursor-pointer rounded border border-gray-300"
              value={form.color}
              onChange={(e) => handleChange('color', e.target.value)}
            />
            <span className="text-sm text-gray-500">{form.color}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={handleSave} disabled={saving || !form.name.trim()}>
          <Plus size={15} />
          {saving ? 'Criando...' : 'Criar turno'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { shiftTypes, shiftTypesLoading, fetchShiftTypes, createShiftType, updateShiftType, deleteShiftType, addToast } =
    useStore();
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    fetchShiftTypes();
  }, []);

  const handleSave = async (id, data) => {
    try {
      await updateShiftType(id, data);
      addToast({ type: 'success', title: 'Turno atualizado!' });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleCreate = async (data) => {
    try {
      await createShiftType(data);
      addToast({ type: 'success', title: 'Turno criado!' });
      setShowNewForm(false);
    } catch (err) {
      addToast({ type: 'error', title: 'Erro ao criar', message: err.response?.data?.error ?? err.message });
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteShiftType(id);
      addToast({ type: 'success', title: 'Turno excluído!' });
    } catch (err) {
      addToast({ type: 'error', title: 'Não foi possível excluir', message: err.response?.data?.error ?? err.message });
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gerencie os tipos de turno disponíveis</p>
      </div>

      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-700">Tipos de Turno</h2>
          {!showNewForm && (
            <button className="btn-primary" onClick={() => setShowNewForm(true)}>
              <Plus size={15} />
              Novo Turno
            </button>
          )}
        </div>

        {shiftTypesLoading ? (
          <div className="text-gray-400 text-sm">Carregando...</div>
        ) : (
          <div className="grid gap-4">
            {shiftTypes.map((shift) => (
              <ShiftTypeEditor key={shift.id} shift={shift} onSave={handleSave} onDelete={handleDelete} />
            ))}
            {showNewForm && (
              <NewShiftForm onCreate={handleCreate} onCancel={() => setShowNewForm(false)} />
            )}
          </div>
        )}

        <div className="card p-4 mt-6 bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Nota:</strong> Alterações nos turnos afetam a geração futura de escalas.
            Turnos em uso em escalas geradas não podem ser excluídos.
          </p>
        </div>
      </div>
    </div>
  );
}
