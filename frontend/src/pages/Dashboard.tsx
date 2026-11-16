import { useQuery } from '@tanstack/react-query';
import { Users, UserCheck, UserX, TrendingUp, Activity, Phone, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { getDashboardStats, getDashboardCharts, getPronostics, getSubscribers } from '../lib/api';
import { formatXOF } from '../lib/format';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';

const ChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="card px-2.5 py-1.5 text-[11px]">
        <p style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className="font-bold mt-0.5" style={{ color: 'var(--yellow-text)' }}>{payload[0]?.value}</p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['stats'], queryFn: getDashboardStats });
  const { data: charts, isLoading: chartsLoading } = useQuery({ queryKey: ['charts'], queryFn: getDashboardCharts });
  const { data: pronostics } = useQuery({ queryKey: ['pronostics'], queryFn: getPronostics });
  const { data: subscribers } = useQuery({ queryKey: ['subscribers'], queryFn: getSubscribers });

  const recentPronostics = pronostics?.slice(0, 5) || [];
  const recentSubscribers = subscribers?.slice(0, 5) || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--text)' }}>Dashboard</h1>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard title="Total Abonnés" value={stats?.totalSubscribers ?? '—'} icon={Users} loading={statsLoading} />
        <StatCard title="Actifs" value={stats?.activeSubscribers ?? '—'} icon={UserCheck} loading={statsLoading} />
        <StatCard title="Expirés" value={stats?.expiredSubscribers ?? '—'} icon={UserX} loading={statsLoading} />
        <StatCard
          title="Revenus du Mois"
          value={stats ? formatXOF(stats.monthRevenue) : '—'}
          icon={TrendingUp}
          loading={statsLoading}
        />
        <StatCard
          title="Requêtes ce mois"
          value={stats?.monthlyRequests ?? '—'}
          icon={Activity}
          loading={statsLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="card p-4">
          <h2 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>
            Évolution Abonnés (30j)
          </h2>
          {chartsLoading ? (
            <div className="skeleton h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={charts?.subscriberGrowth || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Area type="monotone" dataKey="count" stroke="#F59E0B" strokeWidth={2} fill="url(#areaGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>
            Requêtes par jour (30j)
          </h2>
          {chartsLoading ? (
            <div className="skeleton h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={charts?.dailyRequests || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Area type="monotone" dataKey="count" stroke="#10B981" strokeWidth={2} fill="url(#reqGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Contacts — pronostics réussis */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={13} style={{ color: 'var(--yellow)' }} />
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Contacts — pronostics réussis
          </h2>
          <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>
            ≥ 2/3 tiercé · 3/4 quarté · 4/5 quinté
          </span>
        </div>
        {chartsLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : !charts?.goodPronos?.length ? (
          <p className="text-xs text-center py-6" style={{ color: 'var(--text-faint)' }}>
            Aucun pronostic réussi trouvé
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Type', 'Score', 'Numéros', 'Contacts'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {charts.goodPronos.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-muted)' }}>{p.date}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: 'var(--yellow-dim)', color: 'var(--yellow-text)' }}>
                        {p.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: '#10B981' }}>
                      {p.matched}/{p.total}
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--text)' }}>
                      {p.nums.join(' – ')}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.recipients.length === 0 ? (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.recipients.map((r: any) => (
                            <span key={r.phone}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                              style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                              <Phone size={9} />
                              {r.name ? `${r.name} · ` : ''}{r.phone}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="card p-4">
          <h2 className="text-xs font-semibold mb-2.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Derniers Pronostics
          </h2>
          {recentPronostics.length === 0 ? (
            <p className="text-xs text-center py-5" style={{ color: 'var(--text-faint)' }}>Aucun pronostic</p>
          ) : (
            <div>
              {recentPronostics.map((p: any, i: number) => (
                <div key={p.id} className="flex items-center justify-between py-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                      {p.proposals?.find((x: any) => x.id === 'prono_du_jour')?.nums?.join(' – ') || 'N/A'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {format(new Date(p.date), 'dd/MM/yyyy', { locale: fr })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--yellow-text)' }}>
                      {(() => { const main = p.proposals?.find((x: any) => x.id === 'prono_du_jour'); return main?.score ?? main?.confidence ?? '—'; })()}/100
                    </span>
                    <Badge status={p.isSent ? 'SENT' : 'DRAFT'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-xs font-semibold mb-2.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Derniers Abonnés
          </h2>
          {recentSubscribers.length === 0 ? (
            <p className="text-xs text-center py-5" style={{ color: 'var(--text-faint)' }}>Aucun abonné</p>
          ) : (
            <div>
              {recentSubscribers.map((s: any, i: number) => (
                <div key={s.id} className="flex items-center justify-between py-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{s.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{s.phone}</p>
                  </div>
                  <Badge status={s.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
