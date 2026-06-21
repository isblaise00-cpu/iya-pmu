import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Send, Target, Activity, ChevronDown, ChevronUp, Clock, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getSportPronosticsToday,
  startSportPipeline,
  getSportScrapingJob,
  sendSportPronostic,
} from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

// ── Types ─────────────────────────────────────────────────────────────────────

type SportJob = {
  id: string;
  status: 'pending' | 'running' | 'finished' | 'error';
  step: string | null;
  progress: number;
  message: string;
  result?: { sport: string; total: number; cached: boolean; ids?: number[] } | null;
  error?: string | null;
};

type Prediction = {
  market: string;
  label: string;
  model_prob: number;
  recommended: boolean;
  rationale: string;
};

type ValueBet = {
  market: string;
  model_prob: number;
  implied_prob: number;
  edge_pct: number;
  odds: number;
};

type SportEvent = {
  id: number;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  externalId: string;
  result?: { homeScore: number | null; awayScore: number | null; outcome: string | null } | null;
};

type SportPronostic = {
  id: number;
  sport: string;
  date: string;
  modelProbs: Record<string, number>;
  predictions: Prediction[];
  valueBets: ValueBet[];
  commentary: string;
  confidence: number;
  isSent: boolean;
  modifiedByAdmin: boolean;
  event: SportEvent;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPORTS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  football: { label: 'Football', icon: Target, color: '#10B981' },
  basketball: { label: 'Basketball', icon: Activity, color: '#F59E0B' },
};

function confidenceColor(c: number): string {
  if (c >= 70) return '#10B981';
  if (c >= 50) return '#F59E0B';
  return '#6B7280';
}

function probBar(prob: number, color: string) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
        <div className="h-1.5 rounded-full" style={{ background: color, width: `${Math.round(prob * 100)}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: 'var(--text-muted)' }}>
        {Math.round(prob * 100)}%
      </span>
    </div>
  );
}

// ── ScrapingProgressModal ─────────────────────────────────────────────────────

function ScrapingProgressModal({
  open, sport, jobId, onDone, onClose,
}: {
  open: boolean; sport: string; jobId: string | null; onDone: () => void; onClose: () => void;
}) {
  const [job, setJob] = useState<SportJob | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    const tick = async () => {
      try {
        const j = await getSportScrapingJob(sport, jobId);
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
  }, [open, sport, jobId, onDone]);

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
          <p className="text-sm text-red-400">{job.error || 'Erreur inconnue'}</p>
        )}

        {job?.status === 'finished' && job.result && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {job.result.cached
              ? `${job.result.total} pronostic(s) déjà disponibles (cache).`
              : `${job.result.total} pronostic(s) généré(s).`}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────

function MatchCard({ prono, sport, onSent }: { prono: SportPronostic; sport: string; onSent: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const ev = prono.event;
  const sportCfg = SPORTS[sport] ?? SPORTS.football;
  const accentColor = sportCfg.color;

  const sendMutation = useMutation({
    mutationFn: () => sendSportPronostic(sport.toUpperCase(), prono.id),
    onSuccess: (data: any) => {
      toast.success(`Envoyé à ${data.sent}/${data.total} abonnés`);
      onSent();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const topPredictions = prono.predictions.filter((p) => p.recommended);
  const result = ev.result;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${accentColor}20`, color: accentColor }}>
                {ev.league}
              </span>
              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                <Clock size={10} /> {ev.kickoff}
              </span>
            </div>
            <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--text)' }}>
              {ev.homeTeam} <span style={{ color: 'var(--text-faint)' }}>vs</span> {ev.awayTeam}
            </p>
            {result && result.homeScore !== null && (
              <p className="text-xs mt-1 font-mono" style={{ color: accentColor }}>
                Résultat : {result.homeScore} – {result.awayScore}
                {result.outcome && <span className="ml-2 opacity-70">({result.outcome})</span>}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: confidenceColor(prono.confidence) }}>
                {prono.confidence}%
              </div>
              <div className="text-xs" style={{ color: 'var(--text-faint)' }}>confiance</div>
            </div>
            {prono.isSent
              ? <Badge status="SENT" />
              : <Badge status="PENDING" />}
          </div>
        </div>

        {/* Top recommendations */}
        {topPredictions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {topPredictions.map((p, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-lg font-medium"
                style={{ background: `${accentColor}15`, color: accentColor, border: `1px solid ${accentColor}30` }}>
                {p.label} · {Math.round(p.model_prob * 100)}%
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            icon={expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          >
            {expanded ? 'Réduire' : 'Détails'}
          </Button>
          {!prono.isSent && (
            <Button
              size="sm"
              icon={<Send size={13} />}
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending ? 'Envoi…' : 'Envoyer'}
            </Button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <div className="p-4 space-y-4">
              {/* Model probabilities */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>
                  Probabilités modèle
                </p>
                <div className="space-y-1.5">
                  {Object.entries(prono.modelProbs).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{key}</span>
                      {probBar(val as number, accentColor)}
                    </div>
                  ))}
                </div>
              </div>

              {/* All predictions */}
              {prono.predictions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>
                    Prédictions
                  </p>
                  <div className="space-y-2">
                    {prono.predictions.map((p, i) => (
                      <div key={i} className="rounded-lg p-2.5"
                        style={{ background: p.recommended ? `${accentColor}10` : 'var(--bg)', border: `1px solid ${p.recommended ? `${accentColor}30` : 'var(--border)'}` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium" style={{ color: p.recommended ? accentColor : 'var(--text-muted)' }}>
                            {p.label}
                          </span>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>
                            {Math.round(p.model_prob * 100)}%
                          </span>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{p.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Value bets */}
              {prono.valueBets.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>
                    Value bets
                  </p>
                  <div className="space-y-1.5">
                    {prono.valueBets.map((vb, i) => (
                      <div key={i} className="flex items-center justify-between text-xs rounded-lg px-2.5 py-2"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{vb.market}</span>
                        <div className="flex items-center gap-3" style={{ color: 'var(--text-faint)' }}>
                          <span>Cote {vb.odds.toFixed(2)}</span>
                          <span className="font-medium" style={{ color: '#10B981' }}>
                            <TrendingUp size={10} className="inline mr-0.5" />
                            +{vb.edge_pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commentary */}
              {prono.commentary && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)' }}>
                    Analyse
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{prono.commentary}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SportsPronostics() {
  const { sport = 'football' } = useParams<{ sport: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const sportUpper = sport.toUpperCase();
  const sportCfg = SPORTS[sport] ?? SPORTS.football;
  const SportIcon = sportCfg.icon;

  const { data: pronostics = [], isLoading } = useQuery<SportPronostic[]>({
    queryKey: ['sports', sport, 'today'],
    queryFn: () => getSportPronosticsToday(sportUpper),
  });

  const startMutation = useMutation({
    mutationFn: (force: boolean) => startSportPipeline(sportUpper, force),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setModalOpen(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePipelineDone = () => {
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] });
    toast.success('Pronostics générés avec succès');
  };

  const alreadyHasPronostics = pronostics.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `${sportCfg.color}20` }}>
            <SportIcon size={18} style={{ color: sportCfg.color }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
              Pronostics {sportCfg.label}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </p>
          </div>
        </div>

        {/* Sport tabs */}
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          {Object.entries(SPORTS).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const isActive = key === sport;
            return (
              <button
                key={key}
                onClick={() => navigate(`/sports/${key}`)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: isActive ? cfg.color : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                }}
              >
                <Icon size={14} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pipeline button — masqué quand les pronostics du jour sont déjà générés */}
      {!alreadyHasPronostics && (
        <div className="flex items-center gap-3">
          <Button
            icon={<Play size={14} />}
            onClick={() => startMutation.mutate(false)}
            disabled={startMutation.isPending}
          >
            {startMutation.isPending ? 'Lancement…' : 'Lancer le pipeline'}
          </Button>
        </div>
      )}
      {alreadyHasPronostics && (
        <span className="text-sm" style={{ color: 'var(--text-faint)' }}>
          {pronostics.length} match(s) aujourd'hui
        </span>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Chargement…</div>
      ) : pronostics.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <SportIcon size={32} className="mx-auto mb-3 opacity-30" style={{ color: sportCfg.color }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Aucun pronostic {sportCfg.label} pour aujourd'hui.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Lancez le pipeline pour générer les pronostics du jour.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pronostics.map((prono) => (
            <MatchCard
              key={prono.id}
              prono={prono}
              sport={sport}
              onSent={() => queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] })}
            />
          ))}
        </div>
      )}

      {/* Progress modal */}
      <ScrapingProgressModal
        open={modalOpen}
        sport={sportUpper}
        jobId={jobId}
        onDone={handlePipelineDone}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
