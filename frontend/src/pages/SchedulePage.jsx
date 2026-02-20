import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Download,
  Trash2,
  LayoutGrid,
  Table,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import useStore from '../store/useStore.js';
import CalendarView from '../components/schedule/CalendarView.jsx';
import WeekView from '../components/schedule/WeekView.jsx';
import MonthSummary from '../components/schedule/MonthSummary.jsx';
import EntryEditPopover from '../components/schedule/EntryEditPopover.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import { exportApi } from '../api/client.js';

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export default function SchedulePage() {
  const {
    currentMonth,
    currentYear,
    scheduleData,
    scheduleLoading,
    scheduleGenerating,
    setCurrentPeriod,
    generateSchedule,
    clearSchedule,
    fetchShiftTypes,
    employees,
    fetchEmployees,
    addToast,
  } = useStore();

  const [viewMode, setViewMode] = useState('table'); // 'calendar' | 'table'
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [generateWarnings, setGenerateWarnings] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  useEffect(() => {
    fetchShiftTypes();
    fetchEmployees();
    setCurrentPeriod(currentMonth, currentYear);
  }, []);

  const navigateMonth = (delta) => {
    let m = currentMonth + delta;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setCurrentPeriod(m, y);
  };

  const handleGenerate = async () => {
    try {
      const result = await generateSchedule(false);
      setGenerateWarnings(result.warnings || []);
      addToast({
        type: 'success',
        title: 'Escala gerada!',
        message: `${result.results?.length || 0} funcionário(s) escalado(s)`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro ao gerar escala', message: err.message });
    }
    setConfirmGenerate(false);
  };

  const handleClear = async () => {
    try {
      await clearSchedule();
      addToast({ type: 'info', title: 'Escala limpa' });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleExport = async (type) => {
    try {
      const blob = type === 'excel'
        ? await exportApi.excel(currentMonth, currentYear)
        : await exportApi.pdf(currentMonth, currentYear);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `escala_${currentYear}_${String(currentMonth).padStart(2, '0')}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast({ type: 'success', title: `Exportado como ${type === 'excel' ? 'Excel' : 'PDF'}` });
    } catch (err) {
      addToast({ type: 'error', title: 'Erro na exportação', message: err.message });
    }
  };

  const hasSchedule = scheduleData?.entries?.length > 0;
  const noEmployees = employees.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap">
        {/* Month nav */}
        <div className="flex items-center gap-1">
          <button className="btn-ghost p-1.5" onClick={() => navigateMonth(-1)}>
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-semibold text-gray-900 min-w-[160px] text-center">
            {MONTH_NAMES_PT[currentMonth - 1]} {currentYear}
          </span>
          <button className="btn-ghost p-1.5" onClick={() => navigateMonth(1)}>
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="h-5 w-px bg-gray-200" />

        {/* Generate */}
        <button
          className="btn-primary"
          onClick={() => {
            if (hasSchedule) setConfirmGenerate(true);
            else handleGenerate();
          }}
          disabled={scheduleGenerating || noEmployees}
          title={noEmployees ? 'Cadastre funcionários primeiro' : ''}
        >
          <RefreshCw size={15} className={scheduleGenerating ? 'animate-spin' : ''} />
          {scheduleGenerating ? 'Gerando...' : 'Gerar Escala'}
        </button>

        {/* Clear */}
        {hasSchedule && (
          <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setConfirmClear(true)}>
            <Trash2 size={15} />
            Limpar
          </button>
        )}

        <div className="flex-1" />

        {/* Export */}
        {hasSchedule && (
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => handleExport('excel')}>
              <FileSpreadsheet size={14} className="text-green-600" />
              Excel
            </button>
            <button className="btn-secondary text-xs" onClick={() => handleExport('pdf')}>
              <FileText size={14} className="text-red-600" />
              PDF
            </button>
          </div>
        )}

        <div className="h-5 w-px bg-gray-200" />

        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setViewMode('table')}
            title="Tabela"
          >
            <Table size={16} />
          </button>
          <button
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setViewMode('calendar')}
            title="Calendário"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Warnings */}
      {generateWarnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800">
              <p className="font-semibold mb-1">Avisos da geração:</p>
              {generateWarnings.map((w, i) => (
                <p key={i}>{w.message}</p>
              ))}
            </div>
            <button
              className="ml-auto text-amber-500 hover:text-amber-700"
              onClick={() => setGenerateWarnings([])}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex gap-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          {scheduleLoading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <RefreshCw size={24} className="animate-spin mr-2" /> Carregando escala...
            </div>
          ) : noEmployees ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
              <p className="text-sm">Cadastre funcionários antes de gerar uma escala.</p>
            </div>
          ) : viewMode === 'table' ? (
            <WeekView
              scheduleData={scheduleData}
              currentMonth={currentMonth}
              currentYear={currentYear}
              onEntryClick={(entry) => {
                setSelectedEntry(entry);
                setEditOpen(true);
              }}
            />
          ) : (
            <CalendarView
              scheduleData={scheduleData}
              currentMonth={currentMonth}
              currentYear={currentYear}
              onEntryClick={(entry) => {
                setSelectedEntry(entry);
                setEditOpen(true);
              }}
            />
          )}
        </div>

        {/* Sidebar summary */}
        <div className="w-56 border-l border-gray-200 p-4 overflow-y-auto bg-gray-50 shrink-0">
          <MonthSummary totals={scheduleData?.totals} />
        </div>
      </div>

      {/* Entry edit */}
      <EntryEditPopover
        open={editOpen}
        onOpenChange={setEditOpen}
        entry={selectedEntry}
      />

      {/* Confirm generate */}
      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Regerar escala"
        description="Isso irá substituir a escala atual (mantendo entradas bloqueadas). Deseja continuar?"
        confirmLabel="Regerar"
        variant="primary"
        onConfirm={handleGenerate}
      />

      {/* Confirm clear */}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Limpar escala"
        description="Isso irá apagar todas as entradas do mês, incluindo as bloqueadas. Essa ação não pode ser desfeita."
        confirmLabel="Limpar tudo"
        onConfirm={handleClear}
      />
    </div>
  );
}
