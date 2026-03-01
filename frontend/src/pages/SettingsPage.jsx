import { useEffect } from 'react';
import useStore from '../store/useStore.js';

export default function SettingsPage() {
  const { shiftTypes, shiftTypesLoading, fetchShiftTypes } = useStore();

  useEffect(() => {
    fetchShiftTypes();
  }, []);

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Turnos fixos do sistema</p>
      </div>

      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-gray-700 mb-4">Tipos de Turno</h2>

        {shiftTypesLoading ? (
          <div className="text-gray-400 text-sm">Carregando...</div>
        ) : (
          <div className="grid gap-3">
            {shiftTypes.map((shift) => (
              <div key={shift.id} className="card p-4 flex items-center gap-4">
                <div
                  className="w-4 h-4 rounded-full shrink-0 border border-gray-300"
                  style={{ backgroundColor: shift.color }}
                />
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{shift.name}</p>
                  <p className="text-sm text-gray-500">
                    {shift.start_time}–{shift.end_time} · {shift.duration_hours}h
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card p-4 mt-6 bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Nota:</strong> Os turnos são fixos e definidos pelo sistema. Não é possível criar, editar ou excluir turnos.
          </p>
        </div>
      </div>
    </div>
  );
}
