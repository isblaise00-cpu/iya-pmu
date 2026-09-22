import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Send, MapPin, Trophy, FileDown, ChevronDown, ChevronUp, Clock, Flag, TrendingUp, BarChart2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { getTodayRace, getPronostics, sendPronostic, startScrapingPipeline, getScrapingJob, fetchResults } from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

type Job = {
  id: string;
  status: 'pending' | 'running' | 'finished' | 'error';
  step: string;
  progress: number;
  message: string;
  result?: { raceId: number; pronosticId: number; cached: boolean } | null;
  error?: string | null;
};

type Horse = { num: number; nom: string; cote_pt: string; cote_tm: string };

type Proposal = {
  id: string;
  title: string;
  subtitle: string;
  nums: number[];
  confidence?: number;
  score?: number;
  odds?: Record<string, string>;
  source?: string;
  selection?: {
    candidates: { num: number; nom: string; press_score: number; odds_score: number; score: number; citations: number }[];
    partners: { source: string; nums: number[] }[];
    odds_columns: string[];
    possible_combinations: number;
    generated_combinations: number;
  };
};

const proposalScore = (p: Proposal) => p.score ?? p.confidence ?? 0;
const scoreLabel = (p: Proposal) => p.score !== undefined ? `${p.score}/100` : `${p.confidence ?? 0}%`;

function SelectionSummary({ proposal }: { proposal?: Proposal }) {
  const selection = proposal?.selection;
  if (!selection) return null;
  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Les sept chevaux sélectionnés</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Presse 70 % · Cotes 30 % · {selection.partners.length} partenaires · {selection.odds_columns.length} colonne(s) de cotes
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left" style={{ color: 'var(--text)' }}>
          <thead style={{ color: 'var(--text-muted)' }}><tr>
            {['Rang', 'Cheval', 'Citations top 5', 'Presse /100', 'Cotes /100', 'Score /100'].map(label => <th key={label} className="py-2 pr-3">{label}</th>)}
          </tr></thead>
          <tbody>{selection.candidates.map((horse, index) => (
            <tr key={horse.num} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="py-2 pr-3">{index + 1}</td>
              <td className="py-2 pr-3 font-medium">{horse.num} · {horse.nom}</td>
              <td className="py-2 pr-3">{horse.citations}/{selection.partners.length}</td>
              <td className="py-2 pr-3">{horse.press_score}</td>
              <td className="py-2 pr-3">{horse.odds_score}</td>
              <td className="py-2 pr-3 font-bold">{horse.score}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {selection.generated_combinations} groupes distincts sur {selection.possible_combinations} possibles parmi ces sept chevaux.
        Objectif : retrouver les chevaux de l’arrivée en désordre. Les scores classent les sélections et ne sont pas des probabilités de réussite.
      </p>
      <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer">Voir les pronostics partenaires utilisés</summary>
        <div className="mt-2 space-y-1">{selection.partners.map(partner => (
          <p key={partner.source}><strong>{partner.source}</strong> : {partner.nums.join(' – ')}</p>
        ))}</div>
      </details>
    </div>
  );
}

function confidenceColor(c: number): string {
  if (c >= 70) return '#10B981';
  if (c >= 50) return '#F59E0B';
  return '#6B7280';
}

function calcHits(proposals: Proposal[], result: any): { hits: number; total: number } | null {
  const pronoDuJour = proposals.find((p) => p.id === 'prono_du_jour');
  if (!pronoDuJour || !result?.arrivalOrder?.length) return null;
  const arrival: number[] = result.arrivalOrder;
  const predicted = new Set(pronoDuJour.nums);
  return { hits: arrival.filter((n) => predicted.has(n)).length, total: arrival.length };
}

// ── Modal pipeline ────────────────────────────────────────────────────────────

function ScrapingProgressModal({ open, jobId, onDone, onClose }:
  { open: boolean; jobId: string | null; onDone: () => void; onClose: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    const tick = async () => {
      try {
        const j = await getScrapingJob(jobId);
        setJob(j);
        if (['finished', 'error'].includes(j.status)) {
          if (intervalRef.current) window.clearInterval(intervalRef.current);
          if (j.status !== 'error') setTimeout(() => onDone(), 800);
        }
      } catch { /* network blip */ }
    };
    tick();
    intervalRef.current = window.setInterval(tick, 1500);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [open, jobId, onDone]);

  if (!open) return null;
  const pct = job?.progress ?? 0;

  return (
    <Modal open={open} onClose={onClose} title="Pipeline en cours" size="md">
      <div className="space-y-4 py-2">
        <div>
          <div className="flex justify-between mb-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{job?.message || 'Initialisation…'}</span>
            <span className="text-sm font-bold" style={{ color: 'var(--yellow-text)' }}>{pct}%</span>
          </div>
          <div className="w-full h-2 rounded-full" style={{ background: 'var(--border)' }}>
            <motion.div
              className="h-2 rounded-full"
              style={{ background: job?.status === 'error' ? '#EF4444' : 'var(--yellow)' }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
        {job?.status === 'error' && (
          <div className="card p-3 text-sm" style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' }}>
            <p className="font-medium mb-1">Erreur durant le pipeline</p>
            <p className="text-xs">{job.error}</p>
          </div>
        )}
        {job?.result?.cached && (
          <div className="card p-3 text-sm" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
            Un pronostic existe déjà pour aujourd'hui.
          </div>
        )}
        {job?.status === 'error' && (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Carte pronostic LLM (compact) ─────────────────────────────────────────────

function ProposalCard({ proposal, horses, featured = false }:
  { proposal: Proposal; horses: Horse[]; featured?: boolean }) {
  const color = confidenceColor(proposalScore(proposal));
  const horseName = (n: number) => horses.find((h) => h.num === n)?.nom || '';

  if (featured) {
    return (
      <div className="card p-4" style={{ borderColor: color, background: `${color}10` }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
              {proposal.title}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {proposal.subtitle}
            </p>
          </div>
          <span className="text-sm font-bold tabular-nums px-2.5 py-1 rounded-full"
            style={{ background: `${color}22`, color }}>
            {scoreLabel(proposal)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {proposal.nums.map((n, i) => (
            <div key={n} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
              <span className="text-[10px] font-bold" style={{ color }}>{i + 1}.</span>
              <span className="text-base font-bold tabular-nums" style={{ color: 'var(--text)' }}>{n}</span>
              {horseName(n) && (
                <span className="text-[11px] max-w-[90px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {horseName(n)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color }}>
          {proposal.title}
        </p>
        <p className="text-xs tabular-nums font-mono" style={{ color: 'var(--text)' }}>
          {proposal.nums.join(' · ')}
        </p>
      </div>
      <span className="text-xs font-bold tabular-nums shrink-0 px-2 py-0.5 rounded-full"
        style={{ background: `${color}20`, color }}>
        {scoreLabel(proposal)}
      </span>
    </div>
  );
}

// ── 20 combinaisons historiques compactes ────────────────────────────────────

function HistoricalCombinations({ proposals, title = 'Combinaisons modèle historique', result }: { proposals: Proposal[]; title?: string; result?: any }) {
  if (!proposals.length) return null;
  const half = Math.ceil(proposals.length / 2);
  const col1 = proposals.slice(0, half);
  const col2 = proposals.slice(half);

  const Row = ({ p, rank }: { p: Proposal; rank: number }) => {
    const color = confidenceColor(proposalScore(p));
    const arrival: number[] = Array.isArray(result?.arrivalOrder) ? result.arrivalOrder.slice(0, p.nums.length) : [];
    const hit = arrival.length === p.nums.length && new Set(arrival).size === p.nums.length && p.nums.every(n => arrival.includes(n));
    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[10px] font-bold tabular-nums w-5 shrink-0 text-right"
          style={{ color: 'var(--text-faint)' }}>
          #{rank}
        </span>
        <span className="flex-1 text-xs tabular-nums font-mono font-medium"
          style={{ color: 'var(--text)' }}>
          {p.nums.join('·')}{hit ? ' ✓ arrivée en désordre' : ''}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full" style={{ width: `${proposalScore(p)}%`, background: color }} />
          </div>
          <span className="text-[10px] tabular-nums text-right" style={{ color }}>
            {scoreLabel(p)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <BarChart2 size={13} style={{ color: 'var(--text-faint)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {title} · {proposals.length}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x" style={{ '--tw-divide-opacity': 1 } as any}>
        <div className="p-2">
          {col1.map((p, i) => <Row key={p.id} p={p} rank={i + 1} />)}
        </div>
        <div className="p-2">
          {col2.map((p, i) => <Row key={p.id} p={p} rank={half + i + 1} />)}
        </div>
      </div>
    </div>
  );
}

// ── En-tête de course ─────────────────────────────────────────────────────────

function RaceHeader({ race }: { race: any }) {
  return (
    <div className="card p-4" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] uppercase tracking-wide font-bold"
              style={{ color: 'var(--yellow-text)' }}>
              {race.raceType || 'Course'} · PMUB
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {format(new Date(race.date), 'EEEE d MMMM yyyy', { locale: fr })}
            </span>
          </div>
          <h2 className="text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
            {race.raceName || 'Programme du jour'}
          </h2>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {race.hippodrome && (
              <span className="flex items-center gap-1"><MapPin size={11} /> {race.hippodrome}</span>
            )}
            {race.distance && <span>{race.distance.toLocaleString('fr-FR')} m</span>}
            {race.numHorses && <span>{race.numHorses} partants</span>}
            {race.startTime && (
              <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--yellow-text)' }}>
                <Clock size={11} /> Départ {race.startTime}
              </span>
            )}
          </div>
        </div>
        {race.pdfUrl && (
          <a href={race.pdfUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg shrink-0"
            style={{ color: 'var(--yellow-text)', border: '1px solid var(--yellow)', background: 'var(--yellow-dim)' }}>
            <FileDown size={12} /> PDF officiel
          </a>
        )}
      </div>
    </div>
  );
}

// ── Arrivée officielle ────────────────────────────────────────────────────────

function ResultsSection({ result, horses, proposals, onFetch, isFetching }: {
  result: any | null;
  horses: Horse[];
  proposals: Proposal[];
  onFetch: () => void;
  isFetching: boolean;
}) {
  const pronoDuJour = proposals.find((p) => p.id === 'prono_du_jour');
  const predictedSet = new Set<number>(pronoDuJour?.nums || []);
  const arrival: number[] = result?.arrivalOrder || [];
  const hits = arrival.filter((n) => predictedSet.has(n)).length;
  const horseName = (n: number) => horses.find((h) => h.num === n)?.nom || '';

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: result ? '1px solid var(--border)' : undefined }}>
        <div className="flex items-center gap-2">
          <Flag size={14} style={{ color: result ? '#10B981' : 'var(--text-faint)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Arrivée officielle
          </span>
          {result && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums"
              style={{
                background: hits === arrival.length ? '#10B98120' : hits > 0 ? '#F59E0B20' : '#6B728020',
                color: hits === arrival.length ? '#10B981' : hits > 0 ? '#F59E0B' : '#6B7280',
              }}>
              {hits}/{arrival.length} pronostiqués
            </span>
          )}
        </div>
        {!result && (
          <Button icon={<Flag size={13} />} variant="secondary" loading={isFetching} onClick={onFetch}>
            Récupérer les résultats
          </Button>
        )}
      </div>

      {result ? (
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            {arrival.map((n, i) => {
              const hit = predictedSet.has(n);
              return (
                <div key={n} className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                  style={{
                    background: hit ? '#10B98115' : 'var(--bg-hover)',
                    border: `1px solid ${hit ? '#10B981' : 'var(--border)'}`,
                  }}>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
                  <span className="text-base font-bold tabular-nums" style={{ color: 'var(--text)' }}>{n}</span>
                  {horseName(n) && (
                    <span className="text-[11px] max-w-[90px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {horseName(n)}
                    </span>
                  )}
                  {hit && <span className="text-[10px] font-bold" style={{ color: '#10B981' }}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Les résultats PMUB seront disponibles après la course.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Bande de taux de succès ───────────────────────────────────────────────────

function SuccessRateBadge({ hits, total }: { hits: number; total: number }) {
  const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
  const color = pct >= 75 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full"
      style={{ background: `${color}20`, color }}>
      {hits}/{total} ✓
    </span>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Pronostics() {
  const qc = useQueryClient();
  const [scrapingJob, setScrapingJob] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<number | null>(null);

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ['todayRace'],
    queryFn: getTodayRace,
    refetchInterval: (query) => {
      const pronostic = (query.state.data as any)?.pronostic;
      return pronostic && !pronostic.result ? 30_000 : false;
    },
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['pronostics'],
    queryFn: getPronostics,
  });

  const startMutation = useMutation({
    mutationFn: (force: boolean) => startScrapingPipeline(force),
    onSuccess: (data) => setScrapingJob(data.jobId),
    onError: (e: any) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => sendPronostic(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['pronostics'] });
      qc.invalidateQueries({ queryKey: ['todayRace'] });
      toast.success(`Envoyé à ${data.sent} abonné(s)`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resultsMutation = useMutation({
    mutationFn: fetchResults,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todayRace'] });
      qc.invalidateQueries({ queryKey: ['pronostics'] });
      toast.success('Arrivée récupérée avec succès');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onPipelineDone = () => {
    setScrapingJob(null);
    qc.invalidateQueries({ queryKey: ['todayRace'] });
    qc.invalidateQueries({ queryKey: ['pronostics'] });
    toast.success('Pronostic du jour disponible');
  };

  const race      = today?.race;
  const pronostic = today?.pronostic;
  const result    = (pronostic as any)?.result ?? null;
  const horses: Horse[]     = (pronostic?.horses   as Horse[])    || [];
  const proposals: Proposal[] = (pronostic?.proposals as Proposal[]) || [];

  // Sépare propositions IA et combinaisons modèle historique
  const consensusProposals = proposals.filter((p) => p.source === 'consensus_v1');
  const llmProposals  = proposals.filter((p) => !p.id.startsWith('hist_') && (p.source !== 'consensus_v1' || p.id === 'prono_du_jour'));
  const histProposals = proposals.filter((p) =>  p.id.startsWith('hist_'));
  const [featured, ...llmRest] = llmProposals;

  // Calcul taux de succès global sur l'historique
  const historyEntries = (history as any[]).filter((p) => p.id !== pronostic?.id);
  const withResults = historyEntries.filter((p) => p.result?.arrivalOrder?.length);
  const globalHits  = withResults.reduce((acc: number, p: any) => {
    const r = calcHits(p.proposals || [], p.result);
    return acc + (r?.hits || 0);
  }, 0);
  const globalTotal = withResults.reduce((acc: number, p: any) => {
    const r = calcHits(p.proposals || [], p.result);
    return acc + (r?.total || 0);
  }, 0);
  const globalRate = globalTotal > 0 ? Math.round((globalHits / globalTotal) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Pronostics du jour</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Source : LONAB Burkina Faso</p>
        </div>
        <div className="flex gap-2">
          {pronostic && !pronostic.isSent && (
            <Button icon={<Send size={14} />} loading={sendMutation.isPending}
              onClick={() => sendMutation.mutate(pronostic.id)}>
              Envoyer aux abonnés
            </Button>
          )}
          {!result && (
            <Button
              variant={race ? 'secondary' : 'primary'}
              icon={<Play size={14} />}
              loading={startMutation.isPending}
              onClick={() => startMutation.mutate(!!race)}
            >
              {race ? 'Régénérer' : 'Lancer le pipeline'}
            </Button>
          )}
        </div>
      </div>

      {/* Course du jour */}
      {todayLoading ? (
        <div className="space-y-3">
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      ) : !race ? (
        <div className="card p-12 text-center">
          <Trophy size={32} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
            Aucun pronostic pour aujourd'hui
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Cliquez sur « Lancer le pipeline » pour générer les pronostics.
          </p>
        </div>
      ) : (
        <>
          <RaceHeader race={race} />

          {/* Prono du jour — mis en avant */}
          {featured && <ProposalCard proposal={featured} horses={horses} featured />}
          <SelectionSummary proposal={featured} />
          {consensusProposals.length > 0 && (
            <HistoricalCombinations proposals={consensusProposals} title="Combinaisons en désordre · score /100" result={result} />
          )}

          {/* Autres propositions LLM en grille compacte */}
          {llmRest.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {llmRest.map((p) => (
                <ProposalCard key={p.id} proposal={p} horses={horses} />
              ))}
            </div>
          )}

          {/* Combinaisons modèle historique */}
          {histProposals.length > 0 && (
            <HistoricalCombinations proposals={histProposals} />
          )}

          {/* Analyse */}
          {pronostic?.commentary && (
            <div className="card p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-muted)' }}>
                Analyse
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
                {pronostic.commentary}
              </p>
              <div className="flex items-center gap-3 mt-3">
                {pronostic.modifiedByAdmin && <Badge status="PENDING" />}
                {pronostic.isSent && <Badge status="SENT" />}
              </div>
            </div>
          )}

          {/* Arrivée officielle */}
          <ResultsSection
            result={result}
            horses={horses}
            proposals={proposals}
            onFetch={() => resultsMutation.mutate()}
            isFetching={resultsMutation.isPending}
          />
        </>
      )}

      {/* ── Historique ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} style={{ color: 'var(--text-faint)' }} />
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Historique
            </h2>
            {historyEntries.length > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                · {historyEntries.length} entrée{historyEntries.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {globalRate !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                Chevaux retrouvés (principale) :
              </span>
              <span className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full"
                style={{
                  background: globalRate >= 75 ? '#10B98120' : globalRate >= 50 ? '#F59E0B20' : '#EF444420',
                  color: globalRate >= 75 ? '#10B981' : globalRate >= 50 ? '#F59E0B' : '#EF4444',
                }}>
                {globalRate}% ({globalHits}/{globalTotal})
              </span>
            </div>
          )}
        </div>

        {historyLoading ? (
          <div className="skeleton h-12 w-full" />
        ) : historyEntries.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Aucun pronostic antérieur.</p>
        ) : (
          <div className="space-y-1">
            {historyEntries.map((p: any) => {
              const entryProposals: Proposal[] = p.proposals || [];
              const pronoDuJour = entryProposals.find((x) => x.id === 'prono_du_jour');
              const llm = entryProposals.filter((x) => !x.id.startsWith('hist_') && x.source !== 'consensus_v1');
              const consensus = entryProposals.filter((x) => x.source === 'consensus_v1');
              const hist = entryProposals.filter((x) => x.id.startsWith('hist_'));
              const hitInfo = calcHits(entryProposals, p.result);
              const raceType = p.race?.raceType || '';
              const isExpanded = historyExpanded === p.id;

              return (
                <div key={p.id} className="card overflow-hidden">
                  {/* Ligne collapsed */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer transition-colors"
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    onClick={() => setHistoryExpanded(isExpanded ? null : p.id)}
                  >
                    {/* Date */}
                    <span className="text-[11px] tabular-nums shrink-0 font-mono"
                      style={{ color: 'var(--text-faint)' }}>
                      {format(new Date(p.date), 'dd/MM/yy', { locale: fr })}
                    </span>

                    {/* Type badge */}
                    {raceType && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--yellow-dim)', color: 'var(--yellow-text)' }}>
                        {raceType}
                      </span>
                    )}

                    {/* Hippodrome + numéros */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text)' }}>
                        {p.race?.hippodrome || p.race?.raceName || `#${p.id}`}
                      </span>
                      {pronoDuJour && (
                        <span className="text-[11px] tabular-nums font-mono ml-2"
                          style={{ color: 'var(--text-faint)' }}>
                          {pronoDuJour.nums.join('·')}
                        </span>
                      )}
                    </div>

                    {/* Taux de succès + statut + chevron */}
                    <div className="flex items-center gap-2 shrink-0">
                      {hitInfo && <SuccessRateBadge hits={hitInfo.hits} total={hitInfo.total} />}
                      <Badge status={p.isSent ? 'SENT' : 'DRAFT'} />
                      {isExpanded
                        ? <ChevronUp size={13} style={{ color: 'var(--text-faint)' }} />
                        : <ChevronDown size={13} style={{ color: 'var(--text-faint)' }} />}
                    </div>
                  </div>

                  {/* Détail expanded */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                        <div className="px-3 pb-3 pt-2 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>

                          {/* Arrivée officielle (priorité si disponible) */}
                          {p.result?.arrivalOrder && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--text-faint)' }}>
                                Arrivée officielle
                              </span>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {(p.result.arrivalOrder as number[]).map((n: number, i: number) => {
                                  const hit = pronoDuJour?.nums.includes(n);
                                  return (
                                    <span key={n}
                                      className="text-xs tabular-nums font-bold px-2 py-0.5 rounded"
                                      style={{
                                        background: hit ? '#10B98120' : 'var(--bg-hover)',
                                        color: hit ? '#10B981' : 'var(--text-muted)',
                                        border: `1px solid ${hit ? '#10B981' : 'var(--border)'}`,
                                      }}>
                                      {i + 1}. {n}{hit ? ' ✓' : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <SelectionSummary proposal={pronoDuJour} />
                          {consensus.length > 0 && (
                            <HistoricalCombinations proposals={consensus} title="Combinaisons en désordre · score /100" result={p.result} />
                          )}
                          {/* Sélections IA */}
                          {llm.length > 0 && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--text-faint)' }}>
                                Sélections IA
                              </span>
                              <div className="mt-1 space-y-0.5">
                                {llm.map((prop) => (
                                  <div key={prop.id} className="flex items-center gap-2 text-[11px]">
                                    <span className="w-28 shrink-0 truncate font-semibold"
                                      style={{ color: confidenceColor(proposalScore(prop)) }}>
                                      {prop.title}
                                    </span>
                                    <span className="tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>
                                      {prop.nums.join(' · ')}
                                    </span>
                                    <span className="ml-auto tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>
                                      {scoreLabel(prop)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Top 5 combinaisons historiques */}
                          {hist.length > 0 && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--text-faint)' }}>
                                Top 5 modèle historique
                              </span>
                              <div className="mt-1 space-y-0.5">
                                {hist.slice(0, 5).map((prop, i) => (
                                  <div key={prop.id} className="flex items-center gap-2 text-[11px]">
                                    <span className="tabular-nums shrink-0 w-5 text-right"
                                      style={{ color: 'var(--text-faint)' }}>#{i + 1}</span>
                                    <span className="tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>
                                      {prop.nums.join('·')}
                                    </span>
                                    <span className="ml-auto tabular-nums shrink-0"
                                      style={{ color: confidenceColor(proposalScore(prop)) }}>
                                      {scoreLabel(prop)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Commentaire */}
                          {p.commentary && (
                            <p className="text-[11px] line-clamp-2 pt-2 italic"
                              style={{ borderTop: '1px solid var(--border)', color: 'var(--text-faint)' }}>
                              {p.commentary}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ScrapingProgressModal
        open={!!scrapingJob}
        jobId={scrapingJob}
        onDone={onPipelineDone}
        onClose={() => setScrapingJob(null)}
      />
    </div>
  );
}
