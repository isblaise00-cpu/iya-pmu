import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Check, X } from 'lucide-react';
import { getResults } from '../lib/api';

function calculateSuccessRate(results: any[]) {
  let total = 0, successTierce = 0, successQuinte = 0;
  for (const r of results) {
    if (!r.pronostic) continue;
    total++;
    const arr: string[] = Array.isArray(r.arrivalOrder) ? r.arrivalOrder : [];
    const tierce: string[] = Array.isArray(r.pronostic.tierce) ? r.pronostic.tierce : [];
    const quinte: string[] = Array.isArray(r.pronostic.quinte) ? r.pronostic.quinte : [];
    if (tierce.filter((h) => arr.slice(0, 3).includes(h)).length >= 2) successTierce++;
    if (quinte.filter((h) => arr.slice(0, 5).includes(h)).length >= 3) successQuinte++;
  }
  return { total, successTierce, successQuinte };
}

export default function Results() {
  const { data: results = [], isLoading } = useQuery({ queryKey: ['results'], queryFn: getResults });

  const stats = calculateSuccessRate(results);
  const tierceRate = stats.total > 0 ? Math.round((stats.successTierce / stats.total) * 100) : 0;
  const quinteRate = stats.total > 0 ? Math.round((stats.successQuinte / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Résultats</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Historique et taux de réussite</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Courses analysées', value: stats.total },
          { label: 'Réussite Tiercé (≥2/3)', value: `${tierceRate}%` },
          { label: 'Réussite Quinté (≥3/5)', value: `${quinteRate}%` },
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
                {['Date', 'Base Pronostiqué', 'Tiercé Pronostiqué', 'Arrivée Officielle', 'Tiercé ✓', 'Quinté ✓'].map((h) => (
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
                  const tierce: string[] = Array.isArray(r.pronostic?.tierce) ? r.pronostic.tierce : [];
                  const quinte: string[] = Array.isArray(r.pronostic?.quinte) ? r.pronostic.quinte : [];
                  const tierceHit = tierce.filter((h) => arr.slice(0, 3).includes(h)).length >= 2;
                  const quinteHit = quinte.filter((h) => arr.slice(0, 5).includes(h)).length >= 3;

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(r.date), 'dd/MM/yyyy', { locale: fr })}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{r.pronostic?.baseHorse || '—'}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {tierce.join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--yellow-text)' }}>
                        {arr.slice(0, 5).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {r.pronostic
                          ? tierceHit
                            ? <Check size={15} style={{ color: 'var(--yellow)' }} />
                            : <X size={15} style={{ color: 'var(--text-faint)' }} />
                          : <span style={{ color: 'var(--text-faint)' }}>—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        {r.pronostic
                          ? quinteHit
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
