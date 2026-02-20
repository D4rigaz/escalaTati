import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MonthSummary({ totals }) {
  if (!totals || totals.length === 0) return null;

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Resumo Mensal</h3>
      <div className="space-y-2">
        {totals.map((t) => {
          const diff = t.total_hours - 160;
          const isOk = Math.abs(diff) <= 12;
          const isOver = diff > 12;

          return (
            <div key={t.employee_id} className="flex items-center justify-between text-sm">
              <span className="text-gray-700 truncate flex-1 mr-2">{t.employee_name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`font-semibold tabular-nums ${
                    isOk ? 'text-green-600' : isOver ? 'text-orange-600' : 'text-red-600'
                  }`}
                >
                  {t.total_hours}h
                </span>
                {isOk ? (
                  <Minus size={14} className="text-green-500" />
                ) : isOver ? (
                  <TrendingUp size={14} className="text-orange-500" />
                ) : (
                  <TrendingDown size={14} className="text-red-500" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-3 border-t pt-2">Alvo: 160h/mês por funcionário</p>
    </div>
  );
}
