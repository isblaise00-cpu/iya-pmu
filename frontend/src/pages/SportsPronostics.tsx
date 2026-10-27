import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Send, Target, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import {
  getSportPronosticsToday,
  startSportPipeline,
  getSportScrapingJob,
  sendSportPronostic,
  getSportLeagues,
  getSportMatches,
} from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type League = { league_id: string; league_name: string; country: string; match_count: number };

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

type ModelProbs = {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  xg_home: number;
  xg_away: number;
};

type SportPronostic = {
  id: number;
  sport: string;
  date: string;
  modelProbs: ModelProbs;
  predictions: Prediction[];
  commentary: string;
  confidence: number;
  isSent: boolean;
  modifiedByAdmin: boolean;
  event: SportEvent;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCENT = '#10B981';

function confidenceColor(c: number): string {
  if (c >= 70) return '#10B981';
  if (c >= 50) return '#F59E0B';
  return '#6B7280';
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
    <Modal open={open} onClose={onClose} title="Génération en cours" size="md">
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
  const ev = prono.event;
  const mp = prono.modelProbs ?? {} as ModelProbs;

  const probHome = Math.round((mp.prob_home ?? 0) * 100);
  const probDraw = Math.round((mp.prob_draw ?? 0) * 100);
  const probAway = Math.round((mp.prob_away ?? 0) * 100);
  const xgHome   = (mp.xg_home ?? 0).toFixed(2);
  const xgAway   = (mp.xg_away ?? 0).toFixed(2);

  const winner   = prono.predictions.find(p => p.market === '1X2' && p.recommended);
  const recOver  = prono.predictions.find(p => p.market === 'Over 2.5' && p.recommended);
  const recBtts  = prono.predictions.find(p => p.market === 'BTTS'     && p.recommended);
  const result   = ev.result;

  const sendMutation = useMutation({
    mutationFn: () => sendSportPronostic(sport.toUpperCase(), prono.id),
    onSuccess: (data: any) => {
      toast.success(`Envoyé à ${data.sent}/${data.total} abonnés`);
      onSent();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 space-y-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {/* Liga + heure */}
      <div className="flex items-center justify-between">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: `${ACCENT}20`, color: ACCENT }}>
          {ev.league}
        </span>
        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
          <Clock size={10} /> {ev.kickoff}
        </span>
      </div>

      {/* Équipes + score */}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-right text-sm font-semibold leading-tight" style={{ color: 'var(--text)' }}>
          {ev.homeTeam}
        </p>
        <div className="flex-shrink-0 text-center w-16">
          {result && result.homeScore !== null
            ? <span className="font-bold text-base" style={{ color: ACCENT }}>{result.homeScore} – {result.awayScore}</span>
            : <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>vs</span>
          }
        </div>
        <p className="flex-1 text-left text-sm font-semibold leading-tight" style={{ color: 'var(--text)' }}>
          {ev.awayTeam}
        </p>
      </div>

      {/* xG */}
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
        <span>xG {xgHome}</span>
        <span className="opacity-40">xG attendus</span>
        <span>xG {xgAway}</span>
      </div>

      {/* Barres 1 / X / 2 */}
      <div className="space-y-1.5">
        {([
          { label: '1 Dom.', prob: probHome, color: '#10B981' },
          { label: 'X Nul',  prob: probDraw, color: '#6B7280' },
          { label: '2 Ext.', prob: probAway, color: '#3B82F6' },
        ] as const).map(({ label, prob, color }) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-14 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{label}</span>
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
              <div className="h-1.5 rounded-full transition-all" style={{ background: color, width: `${prob}%` }} />
            </div>
            <span className="font-mono w-8 text-right" style={{ color: 'var(--text-muted)' }}>{prob}%</span>
          </div>
        ))}
      </div>

      {/* Recommandations */}
      {(winner || recOver || recBtts) && (
        <div className="flex flex-wrap gap-2">
          {winner && (
            <span className="text-xs px-2 py-1 rounded-lg font-medium"
              style={{ background: '#10B98115', color: '#10B981', border: '1px solid #10B98130' }}>
              ✓ {winner.label}
            </span>
          )}
          {recOver && (
            <span className="text-xs px-2 py-1 rounded-lg font-medium"
              style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
              Over 2.5
            </span>
          )}
          {recBtts && (
            <span className="text-xs px-2 py-1 rounded-lg font-medium"
              style={{ background: '#8B5CF615', color: '#8B5CF6', border: '1px solid #8B5CF630' }}>
              BTTS
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Confiance</span>
          <span className="text-sm font-bold" style={{ color: confidenceColor(prono.confidence) }}>
            {prono.confidence}%
          </span>
          {prono.isSent ? <Badge status="SENT" /> : <Badge status="PENDING" />}
        </div>
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
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SportsPronostics() {
  const { sport = 'football' } = useParams<{ sport: string }>();
  const queryClient = useQueryClient();

  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<{ id: string; name: string } | null>(null);

  const sportUpper = sport.toUpperCase();

  const { data: pronostics = [], isLoading } = useQuery<SportPronostic[]>({
    queryKey: ['sports', sport, 'today'],
    queryFn: () => getSportPronosticsToday(sportUpper),
  });

  const { data: leaguesData } = useQuery<{ date: string; total: number; leagues: League[] }>({
    queryKey: ['sports', sport, 'leagues'],
    queryFn: () => getSportLeagues(sportUpper),
    staleTime: 5 * 60 * 1000,
  });

  type MatchPrediction = {
    bsd_prob_home: number; bsd_prob_draw: number; bsd_prob_away: number;
    bsd_predicted: string;
    bsd_xg_home: number; bsd_xg_away: number;
    bsd_prob_over_15: number; bsd_prob_over_25: number; bsd_prob_over_35: number;
    bsd_prob_btts: number;
    bsd_confidence: number;
    bsd_favorite: string; bsd_favorite_prob: number;
  };
  type Match = {
    external_id: string; home_team: string; away_team: string;
    kickoff: string; status: string; round: string;
    prediction?: MatchPrediction;
  };
  const { data: matchesData, isFetching: matchesFetching } = useQuery<{
    date: string; league_id: string; league_name: string; matches: Match[];
  }>({
    queryKey: ['sports', sport, 'matches', selectedLeague?.id],
    queryFn: () => getSportMatches(sportUpper, selectedLeague!.id),
    enabled: !!selectedLeague,
    staleTime: 5 * 60 * 1000,
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

  // Groupement par ligue
  const byLeague = pronostics.reduce<Record<string, SportPronostic[]>>((acc, p) => {
    const league = p.event.league ?? 'Autre';
    if (!acc[league]) acc[league] = [];
    acc[league].push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `${ACCENT}20` }}>
            <Target size={18} style={{ color: ACCENT }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
              Pronostics Football
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {alreadyHasPronostics && (
            <span className="text-sm" style={{ color: 'var(--text-faint)' }}>
              {pronostics.length} match(s) aujourd'hui
            </span>
          )}
          {!alreadyHasPronostics && (
            <Button
              icon={<Play size={14} />}
              onClick={() => startMutation.mutate(false)}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? 'Génération…' : 'Générer'}
            </Button>
          )}
        </div>
      </div>

      {/* Ligues disponibles aujourd'hui */}
      {leaguesData && leaguesData.leagues.length > 0 && (
        <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
              Championnats disponibles aujourd'hui
            </p>
            {leaguesData.total > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${ACCENT}20`, color: ACCENT }}>
                {leaguesData.total} Championnats
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {leaguesData.leagues.map((l: League) => {
              const isSelected = selectedLeague?.id === l.league_id;
              return (
                <button
                  key={l.league_id}
                  onClick={() => setSelectedLeague(isSelected ? null : { id: l.league_id, name: l.league_name })}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all"
                  style={{
                    background: isSelected ? ACCENT : `${ACCENT}15`,
                    color: isSelected ? '#fff' : ACCENT,
                    border: `1px solid ${isSelected ? ACCENT : `${ACCENT}30`}`,
                    cursor: 'pointer',
                  }}
                >
                  <span>{l.league_name}</span>
                  {l.country && (
                    <span className="opacity-60 font-normal">{l.country}</span>
                  )}
                  <span
                    className="text-xs font-bold rounded-full px-1.5 py-0.5"
                    style={{
                      background: isSelected ? 'rgba(255,255,255,0.25)' : `${ACCENT}30`,
                      color: isSelected ? '#fff' : ACCENT,
                    }}
                  >
                    {l.match_count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Matchs du championnat sélectionné */}
          {selectedLeague && (
            <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selectedLeague.name} — matchs du jour
                </p>
                <button onClick={() => setSelectedLeague(null)} style={{ color: 'var(--text-faint)' }}>
                  <X size={14} />
                </button>
              </div>
              {matchesFetching ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Chargement…</p>
              ) : !matchesData || matchesData.matches.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Aucun match trouvé pour ce championnat.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {matchesData.matches.map((m) => {
                    const p = m.prediction;
                    const probH = p ? Math.round(p.bsd_prob_home) : null;
                    const probD = p ? Math.round(p.bsd_prob_draw) : null;
                    const probA = p ? Math.round(p.bsd_prob_away) : null;
                    const predicted = p?.bsd_predicted;
                    const confidence = p ? Math.round(p.bsd_confidence * 100) : null;
                    const predictedLabel = predicted === 'H' ? `Victoire ${m.home_team}` : predicted === 'A' ? `Victoire ${m.away_team}` : 'Match nul';
                    return (
                      <div
                        key={m.external_id}
                        className="rounded-lg p-3 space-y-2.5"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                      >
                        {/* Heure */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold" style={{ color: ACCENT }}>{m.kickoff}</span>
                          {m.round && <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{m.round}</span>}
                        </div>

                        {/* Équipes */}
                        <div className="text-center">
                          <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text)' }}>
                            {m.home_team} <span style={{ color: 'var(--text-faint)' }}>vs</span> {m.away_team}
                          </p>
                        </div>

                        {p && (
                          <>
                            {/* Pronostic principal */}
                            <div className="rounded-md px-3 py-2 text-center"
                              style={{ background: `${ACCENT}15`, border: `1px solid ${ACCENT}30` }}>
                              <p className="text-xs font-bold" style={{ color: ACCENT }}>{predictedLabel}</p>
                              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                Probabilité {predicted === 'H' ? probH : predicted === 'A' ? probA : probD}%
                                {confidence !== null && ` · Confiance ${confidence}%`}
                              </p>
                            </div>

                            {/* Chances des 3 issues en texte */}
                            <div className="grid grid-cols-3 gap-1 text-center">
                              {([
                                { label: m.home_team.split(' ')[0], sublabel: 'gagne', prob: probH!, active: predicted === 'H', color: '#10B981' },
                                { label: 'Match', sublabel: 'nul',   prob: probD!, active: predicted === 'D', color: '#6B7280' },
                                { label: m.away_team.split(' ')[0], sublabel: 'gagne', prob: probA!, active: predicted === 'A', color: '#3B82F6' },
                              ]).map(({ label, sublabel, prob, active, color }) => (
                                <div key={label} className="rounded px-1 py-1.5"
                                  style={{ background: active ? `${color}20` : 'transparent', border: `1px solid ${active ? color : 'var(--border)'}` }}>
                                  <p className="text-[10px] font-bold truncate" style={{ color: active ? color : 'var(--text-muted)' }}>{label}</p>
                                  <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{sublabel}</p>
                                  <p className="text-xs font-bold mt-0.5" style={{ color: active ? color : 'var(--text-muted)' }}>{prob}%</p>
                                </div>
                              ))}
                            </div>

                            {/* Marchés secondaires */}
                            <div className="flex flex-wrap gap-1 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-faint)', background: 'var(--border)' }}>
                                Buts attendus : {p.bsd_xg_home.toFixed(1)} – {p.bsd_xg_away.toFixed(1)}
                              </span>
                              {p.bsd_prob_over_25 >= 55 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                                  Plus de 2.5 buts ({Math.round(p.bsd_prob_over_25)}%)
                                </span>
                              )}
                              {p.bsd_prob_btts >= 55 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{ background: '#8B5CF615', color: '#8B5CF6' }}>
                                  Les deux marquent ({Math.round(p.bsd_prob_btts)}%)
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Chargement…</div>
      ) : pronostics.length === 0 && !(leaguesData && leaguesData.leagues.length > 0) ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Target size={32} className="mx-auto mb-3 opacity-30" style={{ color: ACCENT }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Aucun match Football disponible pour aujourd'hui.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Revenez plus tard ou vérifiez la configuration des championnats.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byLeague).map(([league, matches]) => (
            <div key={league}>
              <h2 className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: 'var(--text-faint)' }}>
                {league} · {matches.length} match{matches.length > 1 ? 's' : ''}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {matches.map((prono) => (
                  <MatchCard
                    key={prono.id}
                    prono={prono}
                    sport={sport}
                    onSent={() => queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] })}
                  />
                ))}
              </div>
            </div>
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
