import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { schedulesApi } from '../../api/client.js';

function formatDateTime(isoString) {
  const d = new Date(isoString);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export default function GenerationHistory({ month, year }) {
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    setExpanded(null);
    schedulesApi
      .getGenerations(month, year)
      .then(setGenerations)
      .catch(() => setGenerations([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  if (loading) {
    return <p className="text-xs text-gray-400 py-2">Carregando...</p>;
  }

  if (generations.length === 0) {
    return (
      <p className="text-xs text-gray-400 text-center py-4">
        Nenhuma geração registrada para este período
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {generations.map((gen) => {
        const isOpen = expanded === gen.id;
        const warnings = gen.params_json?.warnings ?? [];
        const warningCount = warnings.length;

        return (
          <div key={gen.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : gen.id)}
            >
              <div>
                <p className="text-xs font-medium text-gray-700">
                  {formatDateTime(gen.generated_at)}
                </p>
                <p className="text-[10px] text-gray-400">
                  {warningCount > 0
                    ? `${warningCount} aviso${warningCount > 1 ? 's' : ''}`
                    : 'Sem avisos'}
                </p>
              </div>
              {isOpen
                ? <ChevronDown size={12} className="text-gray-400 shrink-0" />
                : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
            </button>

            {isOpen && (
              <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50">
                {warningCount > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-[10px] text-gray-600">
                        • {w.message}
                        {w.date && (
                          <span className="text-gray-400 ml-1">({w.date})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-2">
                    Nenhum aviso nesta geração.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
