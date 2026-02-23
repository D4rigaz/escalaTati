import { Pencil, Trash2, Clock, Calendar } from 'lucide-react';

const SETOR_ABBR = {
  'Transporte Ambulância': 'Ambul.',
  'Transporte Hemodiálise': 'Hemodi.',
  'Transporte Administrativo': 'Adm.',
};

const WORK_SCHEDULE_LABEL = {
  seg_sex: 'Seg–Sex',
  dom_sab: 'Dom–Sáb',
};

export default function EmployeeCard({ employee, onEdit, onDelete }) {
  const { restRules, setores = [], color = '#6B7280', work_schedule = 'dom_sab' } = employee;

  const setoresLabel = setores.map((s) => SETOR_ABBR[s] || s).join(' + ') || '—';
  const scheduleLabel = WORK_SCHEDULE_LABEL[work_schedule] || work_schedule;

  return (
    <div className="card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {/* Color dot */}
          <span
            className="shrink-0 mt-1 inline-block rounded-full border border-white shadow-sm"
            style={{ width: 12, height: 12, backgroundColor: color }}
          />
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{employee.name}</h3>
            <p className="text-sm text-gray-500">
              {employee.cargo} · {setoresLabel}
            </p>
          </div>
        </div>
        <div className="flex gap-1 shrink-0 ml-2">
          <button
            onClick={() => onEdit(employee)}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => onDelete(employee)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="flex gap-3 text-xs text-gray-500">
        {restRules && (
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {restRules.min_rest_hours}h descanso
          </span>
        )}
        <span className="flex items-center gap-1">
          <Calendar size={12} />
          {scheduleLabel}
        </span>
      </div>
    </div>
  );
}
