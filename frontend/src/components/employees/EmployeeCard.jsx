import { Pencil, Trash2, Clock, Coffee } from 'lucide-react';

export default function EmployeeCard({ employee, onEdit, onDelete }) {
  const { restRules } = employee;

  return (
    <div className="card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{employee.name}</h3>
          <p className="text-sm text-gray-500">
            {employee.cargo} · {employee.setor}
          </p>
        </div>
        <div className="flex gap-1">
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

      {restRules && (
        <div className="flex gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {restRules.min_rest_hours}h descanso
          </span>
          <span className="flex items-center gap-1">
            <Coffee size={12} />
            {restRules.days_off_per_week}x folga/sem
          </span>
        </div>
      )}
    </div>
  );
}
