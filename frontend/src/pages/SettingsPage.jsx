import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import useStore from '../store/useStore.js';

function ShiftTypeEditor({ shift, onSave }) {
  const [form, setForm] = useState({ ...shift });
  const [saving, setSaving] = useState(false);

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
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-4 h-4 rounded-full shrink-0 border border-gray-300"
          style={{ backgroundColor: form.color }}
        />
        <h3 className="font-semibold text-gray-900">{shift.name}</h3>
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
  );
}

export default function SettingsPage() {
  const { shiftTypes, shiftTypesLoading, fetchShiftTypes, updateShiftType, addToast } = useStore();

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

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Edite os tipos de turno disponíveis</p>
      </div>

      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-gray-700 mb-4">Tipos de Turno</h2>

        {shiftTypesLoading ? (
          <div className="text-gray-400 text-sm">Carregando...</div>
        ) : (
          <div className="grid gap-4">
            {shiftTypes.map((shift) => (
              <ShiftTypeEditor key={shift.id} shift={shift} onSave={handleSave} />
            ))}
          </div>
        )}

        <div className="card p-4 mt-6 bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Nota:</strong> Alterações nos turnos afetam a geração futura de escalas.
            Escalas já geradas usarão os horários registrados no momento da geração.
          </p>
        </div>
      </div>
    </div>
  );
}
