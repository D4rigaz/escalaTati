import * as Dialog from '@radix-ui/react-dialog';
import { X, Lock, Unlock } from 'lucide-react';
import { useState, useEffect } from 'react';
import useStore from '../../store/useStore.js';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function EntryEditPopover({ open, onOpenChange, entry }) {
  const { shiftTypes, updateScheduleEntry, addToast } = useStore();
  const [shiftTypeId, setShiftTypeId] = useState('');
  const [isDayOff, setIsDayOff] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      setShiftTypeId(entry.shift_type_id ? String(entry.shift_type_id) : '');
      setIsDayOff(Boolean(entry.is_day_off));
      setIsLocked(Boolean(entry.is_locked));
      setNotes(entry.notes || '');
    }
  }, [entry]);

  if (!entry) return null;

  const dateFormatted = format(parseISO(entry.date), "EEEE, d 'de' MMMM", { locale: ptBR });

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateScheduleEntry(entry.id, {
        shift_type_id: isDayOff ? null : shiftTypeId ? parseInt(shiftTypeId) : null,
        is_day_off: isDayOff ? 1 : 0,
        is_locked: 1, // always lock after manual edit
        notes: notes || null,
      });
      addToast({ type: 'success', title: 'Entrada atualizada', message: `${entry.employee_name} — ${entry.date}` });
      onOpenChange(false);
    } catch (err) {
      addToast({ type: 'error', title: 'Erro ao salvar', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <Dialog.Title className="font-semibold text-gray-900">{entry.employee_name}</Dialog.Title>
              <p className="text-xs text-gray-500 capitalize">{dateFormatted}</p>
            </div>
            <div className="flex items-center gap-2">
              {isLocked && (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  <Lock size={11} /> Bloqueada
                </span>
              )}
              <Dialog.Close asChild>
                <button className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="space-y-3">
            {/* Day off toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-blue-600"
                checked={isDayOff}
                onChange={(e) => setIsDayOff(e.target.checked)}
              />
              <span className="text-sm text-gray-700">Folga</span>
            </label>

            {/* Shift selector */}
            {!isDayOff && (
              <div>
                <label className="label">Turno</label>
                <select
                  className="input"
                  value={shiftTypeId}
                  onChange={(e) => setShiftTypeId(e.target.value)}
                >
                  <option value="">Sem turno definido</option>
                  {shiftTypes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.start_time}–{s.end_time}, {s.duration_hours}h)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="label">Observação</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opcional..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Dialog.Close asChild>
              <button className="btn-secondary">Cancelar</button>
            </Dialog.Close>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
