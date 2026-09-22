import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Check, X } from 'lucide-react';
import { getResults } from '../lib/api';
import { pronosticCoverage } from '../lib/pronostic-coverage';

function calculateSuccessRate(results: any[]) {
  let total = 0, mainSuccess = 0, covered = 0;
  for (const r of results) {
    if (!r.pronostic) continue;
    const evaluation = pronosticCoverage(r.pronostic.proposals || [], r.arrivalOrder || []);
    if (!evaluation.complete) continue;
    total++;
    if (evaluation.mainHits === evaluation.size) mainSuccess++;
    if (evaluation.covered) covered++;
  }
  return { total, mainSuccess, covered };
}

export default function Results() {
  const { data: results = [], isLoading } = useQuery({ queryKey: ['results'], queryFn: getResults });

  const stats = calculateSuccessRate(results);
  const mainRate = stats.total > 0 ? Math.round((stats.mainSuccess / stats.total) * 100) : 0;
  const coverageRate = stats.total > 0 ? Math.round((stats.covered / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Résultats</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Arrivées complètes retrouvées en désordre. Les résultats incomplets sont exclus des taux.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Courses analysées', value: stats.total },
          { label: 'Sélection principale complète', value: `${mainRate}%` },
          { label: 'Arrivée couverte par une combinaison', value: `${coverageRate}%` },
        ].map(({ label, value }) => (
          <div key={label} className="card p-5">
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--yellow-text)' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Comparaison Pronostic vs Résultat</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Course', 'Sélection principale', 'Arrivée officielle', 'Chevaux retrouvés (meilleur groupe)', 'Arrivée couverte'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1,2,3].map(i => (
                  <tr key={i}>{[1,2,3,4,5,6].map(j => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-16" /></td>
                  ))}</tr>
                ))
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                    Aucun résultat
                  </td>
                </tr>
              ) : (
                results.map((r: any) => {
                  const arr: string[] = Array.isArray(r.arrivalOrder) ? r.arrivalOrder : [];
                  const proposals = r.pronostic?.proposals || [];
                  const main = proposals.find((p: any) => p.id === 'prono_du_jour');
                  const evaluation = pronosticCoverage(proposals, arr.map(Number));

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(r.date), 'dd/MM/yyyy', { locale: fr })}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{r.pronostic?.race?.raceType || '—'}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {main?.nums?.join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--yellow-text)' }}>
                        {arr.slice(0, 5).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{evaluation.size ? `${evaluation.bestHits}/${evaluation.size}${evaluation.complete ? '' : ' · arrivée incomplète'}` : '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {evaluation.complete
                          ? evaluation.covered
                            ? <Check size={15} style={{ color: 'var(--yellow)' }} />
                            : <X size={15} style={{ color: 'var(--text-faint)' }} />
                          : <span style={{ color: 'var(--text-faint)' }}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
