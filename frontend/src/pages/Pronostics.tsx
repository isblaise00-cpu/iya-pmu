import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Send, MapPin, Trophy, FileDown, ChevronDown, ChevronUp, Clock, Flag } from 'lucide-react';
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
  confidence: number;
  odds: Record<string, string>;
};

function confidenceColor(c: number): string {
  if (c >= 70) return '#10B981';
  if (c >= 50) return '#F59E0B';
  return '#6B7280';
}

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

function ProposalCard({ proposal, horses, featured = false }:
  { proposal: Proposal; horses: Horse[]; featured?: boolean }) {
  const color = confidenceColor(proposal.confidence);
  const horseName = (n: number) => horses.find((h) => h.num === n)?.nom || '';

  return (
    <div
      className="card p-4 flex flex-col gap-3"
      style={{
        borderColor: featured ? color : 'var(--border)',
        background: featured ? `${color}12` : 'var(--bg-surface)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
            {proposal.title}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {proposal.subtitle}
          </p>
        </div>
        <span
          className="text-xs font-bold tabular-nums shrink-0 px-2 py-0.5 rounded-full"
          style={{ background: `${color}22`, color }}
        >
          {proposal.confidence}%
        </span>
      </div>

      <div className="space-y-1.5">
        {proposal.nums.map((n, i) => (
          <div key={n} className="flex items-center gap-2 text-sm">
            <span className="font-bold tabular-nums w-4 shrink-0 text-right" style={{ color }}>
              {i + 1}.
            </span>
            <span className="font-bold tabular-nums w-6 shrink-0" style={{ color: 'var(--text)' }}>
              {n}
            </span>
            <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {horseName(n)}
            </span>
            <span className="text-[11px] tabular-nums shrink-0 font-mono" style={{ color: 'var(--text-faint)' }}>
              {proposal.odds[String(n)] || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RaceHeader({ race }: { race: any }) {
  return (
    <div className="card p-5" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide font-bold" style={{ color: 'var(--yellow-text)' }}>
          {race.raceType || 'Course'} · PMUB
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {format(new Date(race.date), 'EEEE d MMMM yyyy', { locale: fr })}
        </span>
      </div>
      <h2 className="text-2xl font-bold mb-1 leading-tight" style={{ color: 'var(--text)' }}>
        {race.raceName || 'Programme du jour'}
      </h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {race.hippodrome && (
          <span className="flex items-center gap-1"><MapPin size={12} /> {race.hippodrome}</span>
        )}
        {race.distance && <span>{race.distance.toLocaleString('fr-FR')} m</span>}
        {race.numHorses && <span>{race.numHorses} partants</span>}
        {race.startTime && (
          <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--yellow-text)' }}>
            <Clock size={12} /> Départ {race.startTime}
          </span>
        )}
        {race.pdfUrl && (
          <a href={race.pdfUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 ml-auto" style={{ color: 'var(--yellow-text)' }}>
            <FileDown size={12} /> PDF officiel
          </a>
        )}
      </div>
    </div>
  );
}

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
  const horseName = (n: number) => horses.find((h) => h.num === n)?.nom || '';
  const hits = arrival.filter((n) => predictedSet.has(n)).length;

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
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums"
              style={{
                background: hits === arrival.length ? '#10B98120' : '#F59E0B20',
                color: hits === arrival.length ? '#10B981' : '#F59E0B',
              }}
            >
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
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {arrival.map((n, i) => {
              const hit = predictedSet.has(n);
              return (
                <div
                  key={n}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                  style={{
                    background: hit ? '#10B98115' : 'var(--bg-hover)',
                    border: `1px solid ${hit ? '#10B981' : 'var(--border)'}`,
                  }}
                >
                  <span className="text-[10px] font-medium tabular-nums w-4 text-right shrink-0"
                    style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
                  <span className="text-base font-bold tabular-nums" style={{ color: 'var(--text)' }}>{n}</span>
                  {horseName(n) && (
                    <span className="text-[11px] max-w-[100px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {horseName(n)}
                    </span>
                  )}
                  {hit && <span className="text-[10px] font-bold" style={{ color: '#10B981' }}>✓</span>}
                </div>
              );
            })}
          </div>
          {result.source && (
            <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
              Source : {result.source}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 py-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Les résultats PMUB seront disponibles après la course. Cliquez sur le bouton pour les récupérer depuis LONAB.
          </p>
        </div>
      )}
    </div>
  );
}

function HorsesTable({ horses }: { horses: Horse[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Partants · {horses.length} chevaux
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
              {['N°', 'Cheval', 'Cote Paris Turf', 'Cote Tiercé Mag'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-muted)', fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {horses.map((h) => (
              <tr key={h.num} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-3 py-2 font-bold tabular-nums" style={{ color: 'var(--text)' }}>{h.num}</td>
                <td className="px-3 py-2 font-medium" style={{ color: 'var(--text)' }}>{h.nom}</td>
                <td className="px-3 py-2 tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>{h.cote_pt || '—'}</td>
                <td className="px-3 py-2 tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>{h.cote_tm || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Pronostics() {
  const qc = useQueryClient();
  const [scrapingJob, setScrapingJob] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<number | null>(null);

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ['todayRace'],
    queryFn: getTodayRace,
    // Auto-refresh toutes les 30s si on a un pronostic sans résultats (poller actif)
    refetchInterval: (query) => {
      const pronostic = (query.state.data as any)?.pronostic;
      return pronostic && !pronostic.result ? 30_000 : false;
    },
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({ queryKey: ['pronostics'], queryFn: getPronostics });

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

  const race = today?.race;
  const pronostic = today?.pronostic;
  const result = (pronostic as any)?.result ?? null;
  const horses: Horse[] = (pronostic?.horses as Horse[]) || [];
  const proposals: Proposal[] = (pronostic?.proposals as Proposal[]) || [];
  const [featured, ...rest] = proposals;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Pronostics du jour</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Source officielle : LONAB Burkina Faso</p>
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
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
      ) : !race ? (
        <div className="card p-12 text-center">
          <Trophy size={32} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
            Aucun pronostic pour aujourd'hui
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Cliquez sur « Lancer le pipeline » pour télécharger le programme officiel LONAB et générer les 10 pronostics.
          </p>
        </div>
      ) : (
        <>
          <RaceHeader race={race} />

          {/* Prono du jour — mis en avant */}
          {featured && (
            <ProposalCard proposal={featured} horses={horses} featured />
          )}

          {/* 9 autres pronostics en grille */}
          {rest.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rest.map((p) => (
                <ProposalCard key={p.id} proposal={p} horses={horses} />
              ))}
            </div>
          )}

          {/* Analyse globale */}
          {pronostic?.commentary && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                Analyse
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
                {pronostic.commentary}
              </p>
              <div className="flex items-center gap-3 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
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

          {/* Tableau des partants */}
          {horses.length > 0 && <HorsesTable horses={horses} />}
        </>
      )}

      {/* Historique */}
      <div>
        <h2 className="text-sm font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Historique
        </h2>
        {historyLoading ? (
          <div className="skeleton h-12 w-full" />
        ) : history.filter((p: any) => p.id !== pronostic?.id).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Aucun pronostic antérieur.</p>
        ) : (
          <div className="space-y-1.5">
            {(history as any[])
              .filter((p) => p.id !== pronostic?.id)
              .map((p) => {
                const proposals: Proposal[] = (p.proposals as Proposal[]) || [];
                const pronoDuJour = proposals.find((x) => x.id === 'prono_du_jour');
                const raceType = p.race?.raceType || '';
                return (
                  <div key={p.id} className="card overflow-hidden">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer transition-colors"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                      onClick={() => setHistoryExpanded(historyExpanded === p.id ? null : p.id)}
                    >
                      <div className="flex-1 min-w-0">
                        {/* Ligne 1 : type · hippodrome · date */}
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {raceType && (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--yellow-dim)', color: 'var(--yellow-text)' }}>
                              {raceType}
                            </span>
                          )}
                          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text)' }}>
                            {p.race?.hippodrome || '—'}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>·</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {format(new Date(p.date), 'dd/MM/yyyy', { locale: fr })}
                          </span>
                        </div>
                        {/* Ligne 2 : nom de la course */}
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {p.race?.raceName || `Pronostic #${p.id}`}
                        </p>
                        {/* Ligne 3 : numéros du prono du jour directement visibles */}
                        {pronoDuJour && (
                          <p className="text-[11px] tabular-nums mt-0.5 font-mono" style={{ color: 'var(--text-faint)' }}>
                            {pronoDuJour.nums.join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {pronoDuJour && (
                          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--yellow-text)' }}>
                            {pronoDuJour.confidence}%
                          </span>
                        )}
                        <Badge status={p.isSent ? 'SENT' : 'DRAFT'} />
                        {historyExpanded === p.id
                          ? <ChevronUp size={14} style={{ color: 'var(--text-faint)' }} />
                          : <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />}
                      </div>
                    </div>
                    <AnimatePresence>
                      {historyExpanded === p.id && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                          <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
                            {/* Tous les pronostics en bref */}
                            <div className="space-y-1">
                              {proposals.map((prop) => (
                                <div key={prop.id} className="flex items-baseline gap-2 text-[11px]">
                                  <span className="font-semibold w-36 shrink-0 truncate"
                                    style={{ color: confidenceColor(prop.confidence) }}>
                                    {prop.title}
                                  </span>
                                  <span className="tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>
                                    {prop.nums.join(' · ')}
                                  </span>
                                  <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                                    {prop.confidence}%
                                  </span>
                                </div>
                              ))}
                            </div>
                            {/* Arrivée officielle (si disponible) */}
                            {p.result?.arrivalOrder && (
                              <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                                <span className="text-[10px] font-semibold uppercase tracking-wide"
                                  style={{ color: 'var(--text-faint)' }}>Arrivée </span>
                                <span className="text-[11px] tabular-nums font-mono font-bold"
                                  style={{ color: '#10B981' }}>
                                  {(p.result.arrivalOrder as number[]).join(' · ')}
                                </span>
                              </div>
                            )}
                            {/* Analyse */}
                            {p.commentary && (
                              <p className="text-[11px] line-clamp-3 pt-1"
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
