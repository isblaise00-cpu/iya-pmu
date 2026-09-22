import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Check, X } from 'lucide-react';
import { getResults } from '../lib/api';
import { pronosticCoverage, HorseCoverage } from '../lib/pronostic-coverage';

function calculateSuccessRate(results: any[]) {
  let total = 0, mainSuccess = 0, covered = 0;
  for (const r of results) {
    if (!r.pronostic) continue;
    const ev = pronosticCoverage(r.pronostic.proposals || [], r.arrivalOrder || []);
    if (!ev.complete) continue;
    total++;
    if (ev.mainHits === ev.arrivalSize) mainSuccess++;
    if (ev.covered) covered++;
  }
  return { total, mainSuccess, covered };
}

/** Couleur d'un cheval arrivant : vert = dans la meilleure combi, sinon intensité selon fréquence */
function horseColor(h: HorseCoverage): string {
  if (h.inBest) return '#10B981';
  if (h.totalProposals === 0) return 'var(--text-faint)';
  const ratio = h.proposalCount / h.totalProposals;
  if (ratio >= 0.5) return 'var(--text-muted)';
  if (ratio > 0) return 'var(--text-faint)';
  return 'var(--text-faint)';
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
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Arrivées retrouvées en désordre. En jaune : chevaux du prono principal. La fraction indique
          dans combien de combinaisons chaque cheval figurait.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Courses analysées', value: stats.total },
          { label: 'Prono principal complet', value: `${mainRate}%` },
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
                {['Date', 'Course', 'Sélection principale (5)', 'Arrivée officielle', 'Prono · Meilleure combi', 'Couverte'].map((h) => (
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
                  const arr: number[] = Array.isArray(r.arrivalOrder) ? r.arrivalOrder.map(Number) : [];
                  const proposals = Array.isArray(r.pronostic?.proposals) ? r.pronostic.proposals : [];
                  const main = proposals.find((p: any) => p.id === 'prono_du_jour');
                  const ev = pronosticCoverage(proposals, arr);

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>

                      {/* Date */}
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(r.date), 'dd/MM/yyyy', { locale: fr })}
                      </td>

                      {/* Race type */}
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {r.pronostic?.race?.raceType || '—'}
                      </td>

                      {/* Sélection principale */}
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {main?.nums?.join(' · ') || '—'}
                      </td>

                      {/* Arrivée officielle — chaque cheval coloré + fraction de couverture */}
                      <td className="px-4 py-3">
                        {ev.horseCoverage.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {ev.horseCoverage.map((h) => (
                              <div key={h.num} className="flex flex-col items-center" style={{ minWidth: 26 }}>
                                <span className="text-sm font-semibold" style={{ color: horseColor(h) }}>
                                  {h.num}
                                </span>
                                <span style={{ fontSize: 9, color: 'var(--text-faint)', lineHeight: 1.2 }}>
                                  {h.proposalCount}/{h.totalProposals}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>—</span>
                        )}
                      </td>

                      {/* Chevaux retrouvés : prono principal + meilleure combinaison */}
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {ev.complete ? (
                          <span>
                            <span style={{ color: ev.mainHits === ev.arrivalSize ? 'var(--yellow)' : 'var(--text-muted)' }}>
                              {ev.mainHits}/{ev.arrivalSize}
                            </span>
                            {' · '}
                            <span style={{ color: ev.bestHits === ev.arrivalSize ? 'var(--yellow)' : 'var(--text-muted)' }}>
                              {ev.bestHits}/{ev.arrivalSize}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>
                            {ev.arrivalSize > 0 ? `${ev.mainHits}/${ev.arrivalSize} · arrivée courte` : '—'}
                          </span>
                        )}
                      </td>

                      {/* Arrivée couverte */}
                      <td className="px-4 py-3">
                        {ev.complete
                          ? ev.covered
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
