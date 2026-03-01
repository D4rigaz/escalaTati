import { Bell } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import useStore from '../../store/useStore.js';

export default function NotificationBell() {
  const { warnings, clearWarnings } = useStore();
  const count = warnings.length;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button aria-label="Notificações" className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell size={20} className="text-gray-600" />
          {count > 0 && (
            <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold
                             rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">Avisos da geração</span>
            {count > 0 && (
              <button
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                onClick={clearWarnings}
              >
                Limpar tudo
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {count === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum aviso</p>
            ) : (
              warnings.map((w, i) => (
                <div key={i} className="px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <p className="text-xs text-gray-700">{w.message}</p>
                  {w.date && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{w.date}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
