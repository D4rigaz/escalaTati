import { NavLink } from 'react-router-dom';
import { Users, Calendar, Settings, Clock } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Escala', icon: Calendar, end: true },
  { to: '/funcionarios', label: 'Funcionários', icon: Users },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-brand-900 text-white flex flex-col shrink-0 min-h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-brand-800">
        <div className="flex items-center gap-2">
          <div className="bg-blue-500 rounded-lg p-1.5">
            <Clock size={18} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Escala</p>
            <p className="text-xs text-brand-300 leading-tight">de Trabalho</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-brand-200 hover:bg-brand-800 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-brand-800">
        <p className="text-xs text-brand-400">MVP · Local</p>
      </div>
    </aside>
  );
}
