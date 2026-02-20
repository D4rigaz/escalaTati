import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import useStore from '../../store/useStore.js';

const icons = {
  success: <CheckCircle size={18} className="text-green-500" />,
  error: <AlertCircle size={18} className="text-red-500" />,
  info: <Info size={18} className="text-blue-500" />,
};

export default function ToastContainer() {
  const { toasts, removeToast } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-3 bg-white rounded-xl shadow-lg border border-gray-200 px-4 py-3 min-w-[280px] max-w-sm animate-in fade-in slide-in-from-bottom-2"
        >
          {icons[toast.type || 'info']}
          <div className="flex-1 min-w-0">
            {toast.title && (
              <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
            )}
            {toast.message && (
              <p className="text-sm text-gray-600">{toast.message}</p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
