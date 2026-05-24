import { useQuery } from '@tanstack/react-query';
import { Users, UserCheck, UserX, TrendingUp, Trophy, Clock, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
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
  const today = stats?.todayPronostic;
  const successRate = charts?.successRate;

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
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard title="Total Abonnés" value={stats?.totalSubscribers ?? '—'} icon={Users} loading={statsLoading} />
        <StatCard title="Actifs" value={stats?.activeSubscribers ?? '—'} icon={UserCheck} loading={statsLoading} />
        <StatCard title="Expirés" value={stats?.expiredSubscribers ?? '—'} icon={UserX} loading={statsLoading} />
        <StatCard
          title="Revenus du Mois"
          value={stats ? formatXOF(stats.monthRevenue) : '—'}
          icon={TrendingUp}
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
            Score de Confiance (30j)
          </h2>
          {chartsLoading ? (
            <div className="skeleton h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={charts?.pronosticsConfidence || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Line type="monotone" dataKey="score" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#F59E0B' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Today's pronostic + success rate + system status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card p-4 lg:col-span-1" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--yellow-text)' }}>
              <Trophy size={12} /> Pronostic du Jour
            </span>
            {today && <Badge status={today.isSent ? 'SENT' : 'DRAFT'} />}
          </div>
          {today ? (
            <>
              <p className="text-sm font-bold mb-2 leading-snug" style={{ color: 'var(--text)' }}>
                {today.baseHorse || 'N/A'}
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold" style={{ color: 'var(--yellow-text)' }}>
                  {today.confidenceScore}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>/100</span>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>confiance</span>
              </div>
              <div className="mt-2 w-full h-1 rounded-full" style={{ background: 'rgba(0,0,0,0.08)' }}>
                <div className="h-1 rounded-full transition-all duration-700"
                  style={{ width: `${today.confidenceScore}%`, background: 'var(--yellow)' }} />
              </div>
            </>
          ) : (
            <p className="text-xs py-3" style={{ color: 'var(--text-muted)' }}>Aucun pronostic généré</p>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-muted)' }}>
              <CheckCircle2 size={12} style={{ color: 'var(--yellow)' }} /> Taux de Réussite
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>30j</span>
          </div>
          {chartsLoading ? (
            <div className="skeleton h-12 w-full" />
          ) : (
            <>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
                  {successRate?.rate ?? 0}%
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {successRate?.success ?? 0}/{successRate?.total ?? 0}
                </span>
              </div>
              <div className="w-full h-1 rounded-full" style={{ background: 'var(--border)' }}>
                <div className="h-1 rounded-full transition-all duration-700"
                  style={{ width: `${successRate?.rate ?? 0}%`, background: 'var(--yellow)' }} />
              </div>
            </>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-muted)' }}>
              <Clock size={12} style={{ color: 'var(--yellow)' }} /> Statut Système
            </span>
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'Scraping', time: '07:00' },
              { label: 'Résultats', time: '18:00' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text)' }}>{item.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{item.time}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
                </span>
              </div>
            ))}
          </div>
        </div>
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
                      {p.baseHorse || 'N/A'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {format(new Date(p.date), 'dd/MM/yyyy', { locale: fr })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--yellow-text)' }}>
                      {p.confidenceScore}
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
