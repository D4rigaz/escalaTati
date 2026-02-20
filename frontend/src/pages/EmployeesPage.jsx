import { useEffect, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import useStore from '../store/useStore.js';
import EmployeeCard from '../components/employees/EmployeeCard.jsx';
import EmployeeForm from '../components/employees/EmployeeForm.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';

export default function EmployeesPage() {
  const { employees, employeesLoading, fetchEmployees, deleteEmployee, shiftTypes, fetchShiftTypes, addToast } = useStore();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    fetchEmployees();
    fetchShiftTypes();
  }, []);

  const filtered = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.cargo.toLowerCase().includes(search.toLowerCase()) ||
      e.setor.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEmployee(deleteTarget.id);
      addToast({ type: 'success', title: 'Funcionário desativado', message: deleteTarget.name });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro', message: err.message });
    }
    setDeleteTarget(null);
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Funcionários</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {employees.length} cadastrado{employees.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditingEmployee(null);
            setFormOpen(true);
          }}
        >
          <Plus size={16} />
          Novo Funcionário
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Buscar por nome, cargo ou setor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      {employeesLoading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
          <Users size={40} className="text-gray-300" />
          <p className="text-sm">
            {search ? 'Nenhum funcionário encontrado' : 'Nenhum funcionário cadastrado'}
          </p>
          {!search && (
            <button
              className="btn-primary mt-2"
              onClick={() => {
                setEditingEmployee(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} />
              Cadastrar primeiro funcionário
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onEdit={handleEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <EmployeeForm
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditingEmployee(null);
        }}
        employee={editingEmployee}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Desativar funcionário"
        description={`Tem certeza que deseja desativar "${deleteTarget?.name}"? O funcionário não aparecerá em novas escalas.`}
        confirmLabel="Desativar"
        onConfirm={handleDelete}
      />
    </div>
  );
}
