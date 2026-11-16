import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Send, Target, Clock, X, Plus, Trash2, CheckSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
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

const API = import.meta.env.VITE_API_URL ?? '/api';

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

// ── SendToNumbersModal ────────────────────────────────────────────────────────

function SendToNumbersModal({
  open, onClose, selectedPronos, sport,
}: {
  open: boolean;
  onClose: () => void;
  selectedPronos: SportPronostic[];
  sport: string;
}) {
  const [phones, setPhones] = useState<string[]>(['']);
  const [sending, setSending] = useState(false);

  const addPhone = () => setPhones((p) => [...p, '']);
  const removePhone = (i: number) => setPhones((p) => p.filter((_, idx) => idx !== i));
  const updatePhone = (i: number, v: string) =>
    setPhones((p) => p.map((x, idx) => (idx === i ? v : x)));

  const validPhones = phones.map((p) => p.trim()).filter(Boolean);

  const handleSend = async () => {
    if (!validPhones.length) return toast.error('Entrez au moins un numéro');
    setSending(true);
    try {
      const { data } = await axios.post(
        `${API}/sports/${sport}/send-to-phones`,
        { pronosticIds: selectedPronos.map((p) => p.id), phones: validPhones },
        { withCredentials: true }
      );
      toast.success(`${data.sent} SMS envoyé(s) sur ${data.total}`);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Envoyer les pronostics" size="md">
      <div className="space-y-5">
        {/* Matchs sélectionnés */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            {selectedPronos.length} match{selectedPronos.length > 1 ? 's' : ''} sélectionné{selectedPronos.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {selectedPronos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                <span className="px-1.5 py-0.5 rounded text-[10px]"
                  style={{ background: `${ACCENT}20`, color: ACCENT }}>{p.event.league}</span>
                <span style={{ color: 'var(--text)' }}>{p.event.homeTeam} vs {p.event.awayTeam}</span>
                <span className="ml-auto opacity-60">{p.event.kickoff}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Numéros destinataires */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Numéros destinataires</p>
            <button onClick={addPhone} className="flex items-center gap-1 text-xs"
              style={{ color: ACCENT }}>
              <Plus size={12} /> Ajouter
            </button>
          </div>
          <div className="space-y-2">
            {phones.map((phone, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="tel"
                  placeholder="+22671000000"
                  value={phone}
                  onChange={(e) => updatePhone(i, e.target.value)}
                  className="input flex-1 text-sm"
                />
                {phones.length > 1 && (
                  <button onClick={() => removePhone(i)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: 'var(--text-faint)' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#EF4444')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text-faint)')}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
            Chaque destinataire recevra {selectedPronos.length} SMS (1 par match).
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button
            icon={<Send size={13} />}
            onClick={handleSend}
            loading={sending}
            disabled={!validPhones.length}
          >
            Envoyer {validPhones.length > 0 ? `(${validPhones.length} destinataire${validPhones.length > 1 ? 's' : ''})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── MatchCard (design compact) ────────────────────────────────────────────────

function MatchCard({
  prono, sport, onSent, selected, onToggle,
}: {
  prono: SportPronostic; sport: string; onSent: () => void;
  selected: boolean; onToggle: () => void;
}) {
  const ev = prono.event;
  const mp = prono.modelProbs ?? {} as ModelProbs;

  const probHome = Math.round((mp.prob_home ?? 0) * 100);
  const probDraw = Math.round((mp.prob_draw ?? 0) * 100);
  const probAway = Math.round((mp.prob_away ?? 0) * 100);
  const xgHome   = mp.xg_home != null ? mp.xg_home.toFixed(1) : null;
  const xgAway   = mp.xg_away != null ? mp.xg_away.toFixed(1) : null;

  const winner  = prono.predictions.find(p => p.market === '1X2'      && p.recommended);
  const recOver = prono.predictions.find(p => p.market === 'Over 2.5' && p.recommended);
  const recBtts = prono.predictions.find(p => p.market === 'BTTS'     && p.recommended);
  const result  = ev.result;

  const sendMutation = useMutation({
    mutationFn: () => sendSportPronostic(sport.toUpperCase(), prono.id),
    onSuccess: (data: any) => { toast.success(`Envoyé à ${data.sent}/${data.total} abonnés`); onSent(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div
      className="rounded-xl p-3 space-y-2.5 cursor-pointer transition-all"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${selected ? ACCENT : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 1px ${ACCENT}40` : 'none',
      }}
      onClick={onToggle}
    >
      {/* Ligne 1 : ligue + heure + checkbox */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
            style={{ background: selected ? ACCENT : 'var(--border)', border: `1px solid ${selected ? ACCENT : 'var(--border)'}` }}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {selected && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>{ev.league}</span>
        </div>
        <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
          <Clock size={10} /> {ev.kickoff}
        </span>
      </div>

      {/* Ligne 2 : équipes + score */}
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-right font-semibold leading-tight truncate" style={{ color: 'var(--text)' }}>{ev.homeTeam}</span>
        <span className="flex-shrink-0 font-bold text-xs w-12 text-center" style={{ color: result?.homeScore != null ? ACCENT : 'var(--text-faint)' }}>
          {result?.homeScore != null ? `${result.homeScore}–${result.awayScore}` : 'vs'}
        </span>
        <span className="flex-1 text-left font-semibold leading-tight truncate" style={{ color: 'var(--text)' }}>{ev.awayTeam}</span>
      </div>

      {/* Ligne 3 : probabilités 1/X/2 */}
      <div className="grid grid-cols-3 gap-1 text-center text-xs">
        {([
          { key: 'home', label: '1', prob: probHome, color: '#10B981' },
          { key: 'draw', label: 'X', prob: probDraw, color: '#6B7280' },
          { key: 'away', label: '2', prob: probAway, color: '#3B82F6' },
        ] as const).map(({ key, label, prob, color }) => (
          <div key={key} className="rounded px-1 py-1"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>{label}</div>
            <div className="font-bold text-sm leading-tight" style={{ color }}>{prob}%</div>
          </div>
        ))}
      </div>

      {/* Ligne 4 : recommandations + xG */}
      <div className="flex flex-wrap items-center gap-1.5">
        {winner && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: '#10B98115', color: '#10B981', border: '1px solid #10B98130' }}>
            ✓ {winner.label}
          </span>
        )}
        {recOver && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>
            +2.5 buts
          </span>
        )}
        {recBtts && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: '#8B5CF615', color: '#8B5CF6', border: '1px solid #8B5CF630' }}>
            BTTS
          </span>
        )}
        {xgHome && xgAway && (
          <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>
            xG {xgHome}–{xgAway}
          </span>
        )}
      </div>

      {/* Ligne 5 : confiance + action */}
      <div className="flex items-center justify-between pt-1.5" style={{ borderTop: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: confidenceColor(prono.confidence) }}>
            {prono.confidence}%
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>confiance</span>
          {prono.isSent && <Badge status="SENT" />}
        </div>
        {!prono.isSent && (
          <Button size="sm" icon={<Send size={12} />}
            onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
            {sendMutation.isPending ? '…' : 'Abonnés'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SportsPronostics() {
  const { sport = 'football' } = useParams<{ sport: string }>();
  const queryClient = useQueryClient();

  const [jobId, setJobId]               = useState<string | null>(null);
  const [modalOpen, setModalOpen]       = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set());
  const [sendOpen, setSendOpen]         = useState(false);

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
    onSuccess: (data) => { setJobId(data.jobId); setModalOpen(true); },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePipelineDone = () => {
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] });
    toast.success('Pronostics générés avec succès');
  };

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedPronos = pronostics.filter((p) => selectedIds.has(p.id));

  const alreadyHasPronostics = pronostics.length > 0;

  const byLeague = pronostics.reduce<Record<string, SportPronostic[]>>((acc, p) => {
    const league = p.event.league ?? 'Autre';
    if (!acc[league]) acc[league] = [];
    acc[league].push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `${ACCENT}20` }}>
            <Target size={18} style={{ color: ACCENT }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Pronostics Football</h1>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {alreadyHasPronostics && (
            <span className="text-sm" style={{ color: 'var(--text-faint)' }}>
              {pronostics.length} match(s)
            </span>
          )}
          {!alreadyHasPronostics && (
            <Button icon={<Play size={14} />} onClick={() => startMutation.mutate(false)} disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Génération…' : 'Générer'}
            </Button>
          )}
        </div>
      </div>

      {/* Ligues disponibles */}
      {leaguesData && leaguesData.leagues.length > 0 && (
        <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
              Championnats disponibles
            </p>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${ACCENT}20`, color: ACCENT }}>
              {leaguesData.total}
            </span>
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
                  }}
                >
                  {l.league_name}
                  {l.country && <span className="opacity-60">{l.country}</span>}
                  <span className="text-[10px] font-bold px-1 py-0.5 rounded-full"
                    style={{ background: isSelected ? 'rgba(255,255,255,0.25)' : `${ACCENT}30` }}>
                    {l.match_count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Matchs du championnat sélectionné */}
          {selectedLeague && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selectedLeague.name}
                </p>
                <button onClick={() => setSelectedLeague(null)} style={{ color: 'var(--text-faint)' }}>
                  <X size={14} />
                </button>
              </div>
              {matchesFetching ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Chargement…</p>
              ) : !matchesData || matchesData.matches.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Aucun match trouvé.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {matchesData.matches.map((m) => {
                    const p = m.prediction;
                    const probH = p ? Math.round(p.bsd_prob_home) : null;
                    const probD = p ? Math.round(p.bsd_prob_draw) : null;
                    const probA = p ? Math.round(p.bsd_prob_away) : null;
                    const predicted = p?.bsd_predicted;
                    const predictedLabel = predicted === 'H'
                      ? `${m.home_team.split(' ')[0]} gagne`
                      : predicted === 'A' ? `${m.away_team.split(' ')[0]} gagne`
                      : 'Nul';
                    return (
                      <div key={m.external_id} className="rounded-lg p-3"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        {/* Heure + Journée */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold" style={{ color: ACCENT }}>{m.kickoff}</span>
                          {m.round && <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{m.round}</span>}
                        </div>
                        {/* Équipes */}
                        <p className="text-xs font-semibold text-center mb-2" style={{ color: 'var(--text)' }}>
                          {m.home_team} <span style={{ color: 'var(--text-faint)' }}>vs</span> {m.away_team}
                        </p>
                        {p ? (
                          <>
                            {/* Pronostic principal */}
                            <div className="rounded px-2 py-1.5 text-center mb-2"
                              style={{ background: `${ACCENT}15`, border: `1px solid ${ACCENT}30` }}>
                              <p className="text-xs font-bold" style={{ color: ACCENT }}>{predictedLabel}</p>
                              <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                                {predicted === 'H' ? probH : predicted === 'A' ? probA : probD}%
                                {p.bsd_confidence != null && ` · conf. ${Math.round(p.bsd_confidence * 100)}%`}
                              </p>
                            </div>
                            {/* 1/X/2 */}
                            <div className="grid grid-cols-3 gap-1 text-center text-[10px] mb-2">
                              {([
                                { key: 'home', label: '1', prob: probH!, active: predicted === 'H', color: '#10B981' },
                                { key: 'draw', label: 'X', prob: probD!, active: predicted === 'D', color: '#6B7280' },
                                { key: 'away', label: '2', prob: probA!, active: predicted === 'A', color: '#3B82F6' },
                              ]).map(({ key, label, prob, active, color }) => (
                                <div key={key} className="rounded px-1 py-1"
                                  style={{ background: active ? `${color}20` : 'transparent', border: `1px solid ${active ? color : 'var(--border)'}` }}>
                                  <div style={{ color: active ? color : 'var(--text-faint)' }}>{label}</div>
                                  <div className="font-bold" style={{ color: active ? color : 'var(--text-muted)' }}>{prob}%</div>
                                </div>
                              ))}
                            </div>
                            {/* Marchés */}
                            <div className="flex flex-wrap gap-1">
                              {p.bsd_xg_home != null && p.bsd_xg_away != null && (
                                <span className="text-[10px] px-1 py-0.5 rounded"
                                  style={{ color: 'var(--text-faint)', background: 'var(--border)' }}>
                                  xG {p.bsd_xg_home.toFixed(1)}–{p.bsd_xg_away.toFixed(1)}
                                </span>
                              )}
                              {p.bsd_prob_over_25 >= 55 && (
                                <span className="text-[10px] px-1 py-0.5 rounded font-medium"
                                  style={{ background: '#F59E0B15', color: '#F59E0B' }}>
                                  +2.5 buts ({Math.round(p.bsd_prob_over_25)}%)
                                </span>
                              )}
                              {p.bsd_prob_btts >= 55 && (
                                <span className="text-[10px] px-1 py-0.5 rounded font-medium"
                                  style={{ background: '#8B5CF615', color: '#8B5CF6' }}>
                                  BTTS ({Math.round(p.bsd_prob_btts)}%)
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-[10px] text-center" style={{ color: 'var(--text-faint)' }}>Pas de prono</p>
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

      {/* Pronostics du jour */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Chargement…</div>
      ) : pronostics.length === 0 && !(leaguesData && leaguesData.leagues.length > 0) ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Target size={32} className="mx-auto mb-3 opacity-30" style={{ color: ACCENT }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Aucun match Football disponible pour aujourd'hui.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byLeague).map(([league, matches]) => (
            <div key={league}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
                  {league} · {matches.length} match{matches.length > 1 ? 's' : ''}
                </h2>
                <button
                  className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
                  style={{ color: 'var(--text-faint)', border: '1px solid var(--border)' }}
                  onClick={() => {
                    const allSelected = matches.every((m) => selectedIds.has(m.id));
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      matches.forEach((m) => allSelected ? next.delete(m.id) : next.add(m.id));
                      return next;
                    });
                  }}
                >
                  {matches.every((m) => selectedIds.has(m.id)) ? 'Tout déselect.' : 'Tout sélect.'}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {matches.map((prono) => (
                  <MatchCard
                    key={prono.id}
                    prono={prono}
                    sport={sport}
                    selected={selectedIds.has(prono.id)}
                    onToggle={() => toggleSelect(prono.id)}
                    onSent={() => queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Barre flottante de sélection */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 px-5 py-3 rounded-2xl shadow-xl z-50"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 320 }}
          >
            <CheckSquare size={16} style={{ color: ACCENT }} />
            <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>
              {selectedIds.size} match{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setSelectedIds(new Set())}>
              Effacer
            </Button>
            <Button size="sm" icon={<Send size={13} />} onClick={() => setSendOpen(true)}>
              Envoyer
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal envoi numéros */}
      <SendToNumbersModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        selectedPronos={selectedPronos}
        sport={sportUpper}
      />

      {/* Modal génération */}
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
