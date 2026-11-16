import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Send, Target, Clock, X, Plus, Trash2, CheckSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import {
  getSportPronosticsToday,
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

type Prediction = {
  market: string; label: string; model_prob: number;
  recommended: boolean; rationale: string;
};

type SportEvent = {
  id: number; sport: string; league: string;
  homeTeam: string; awayTeam: string; kickoff: string; externalId: string;
  result?: { homeScore: number | null; awayScore: number | null; outcome: string | null } | null;
};

type ModelProbs = {
  prob_home: number; prob_draw: number; prob_away: number;
  xg_home: number; xg_away: number;
};

type SportPronostic = {
  id: number; sport: string; date: string;
  modelProbs: ModelProbs; predictions: Prediction[];
  commentary: string; confidence: number;
  isSent: boolean; modifiedByAdmin: boolean;
  event: SportEvent;
};

type FootballPrediction = {
  bsd_prob_home: number; bsd_prob_draw: number; bsd_prob_away: number;
  bsd_predicted: string;
  bsd_xg_home: number; bsd_xg_away: number;
  bsd_prob_over_25: number; bsd_prob_btts: number;
  bsd_confidence: number;
};

type BasketballPrediction = {
  winner: string;
  prob_home: number; prob_away: number;
  prob_over_205: number; prob_over_215: number; prob_over_225: number;
  confidence: string; confidence_score: number;
  elo_home: number; elo_away: number;
};

type Match = {
  external_id: string; home_team: string; away_team: string;
  kickoff: string; status: string; round?: string; league?: string;
  prediction?: FootballPrediction | BasketballPrediction;
};

// Match sélectionné pour envoi SMS
type SelectedMatch = {
  externalId: string;
  home: string; away: string; league: string; kickoff: string;
  market: string; confidence: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCENT = '#10B981';

function confidenceColor(c: number): string {
  if (c >= 70) return '#10B981';
  if (c >= 50) return '#F59E0B';
  return '#6B7280';
}

function isFootball(p: FootballPrediction | BasketballPrediction): p is FootballPrediction {
  return 'bsd_predicted' in p;
}

function buildMarket(m: Match, leagueName: string): SelectedMatch {
  const p = m.prediction;
  let market = 'N/A';
  let confidence = 0;
  if (p) {
    if (isFootball(p)) {
      const label = p.bsd_predicted === 'H'
        ? `${m.home_team} gagne`
        : p.bsd_predicted === 'A' ? `${m.away_team} gagne`
        : 'Match nul';
      const parts = [label];
      if (p.bsd_prob_over_25 >= 55) parts.push('+2.5 buts');
      if (p.bsd_prob_btts    >= 55) parts.push('2 équipes marquent');
      market = parts.join(', ');
      confidence = Math.round(p.bsd_confidence * 100);
    } else {
      const parts = [`${p.winner} gagne`];
      if (p.prob_over_225 >= 0.55)      parts.push('+225 pts');
      else if (p.prob_over_215 >= 0.55) parts.push('+215 pts');
      else if (p.prob_over_205 >= 0.55) parts.push('+205 pts');
      market = parts.join(', ');
      confidence = Math.round(p.confidence_score * 100);
    }
  }
  return {
    externalId: m.external_id,
    home: m.home_team, away: m.away_team,
    league: leagueName, kickoff: m.kickoff,
    market, confidence,
  };
}

// ── ScrapingProgressModal ─────────────────────────────────────────────────────

// ── SendToNumbersModal ────────────────────────────────────────────────────────

function SendToNumbersModal({ open, onClose, selectedMatches, sport }: {
  open: boolean; onClose: () => void;
  selectedMatches: SelectedMatch[]; sport: string;
}) {
  const [phones, setPhones] = useState<string[]>(['']);
  const [sending, setSending] = useState(false);

  const addPhone    = () => setPhones((p) => [...p, '']);
  const removePhone = (i: number) => setPhones((p) => p.filter((_, idx) => idx !== i));
  const updatePhone = (i: number, v: string) => setPhones((p) => p.map((x, idx) => idx === i ? v : x));

  const validPhones = phones.map((p) => p.trim()).filter(Boolean);

  const handleSend = async () => {
    if (!validPhones.length) return toast.error('Entrez au moins un numéro');
    setSending(true);
    try {
      const { data } = await axios.post(
        `${API}/sports/${sport}/send-to-phones`,
        {
          matches: selectedMatches.map((m) => ({
            home: m.home, away: m.away, league: m.league,
            kickoff: m.kickoff, market: m.market, confidence: m.confidence,
          })),
          phones: validPhones,
        },
        { withCredentials: true }
      );
      toast.success(`${data.sent} SMS envoyé(s) sur ${data.total}`);
      setPhones(['']);
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
            {selectedMatches.length} match{selectedMatches.length > 1 ? 's' : ''} sélectionné{selectedMatches.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {selectedMatches.map((m) => (
              <div key={m.externalId} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'var(--bg-hover)' }}>
                <span className="px-1.5 py-0.5 rounded text-[10px] flex-shrink-0"
                  style={{ background: `${ACCENT}20`, color: ACCENT }}>{m.league}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                  {m.home} vs {m.away}
                </span>
                <span className="opacity-60 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{m.kickoff}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Numéros */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Numéros destinataires</p>
            <button onClick={addPhone} className="flex items-center gap-1 text-xs" style={{ color: ACCENT }}>
              <Plus size={12} /> Ajouter
            </button>
          </div>
          <div className="space-y-2">
            {phones.map((phone, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="tel" placeholder="+22671000000" value={phone}
                  onChange={(e) => updatePhone(i, e.target.value)}
                  className="input flex-1 text-sm" />
                {phones.length > 1 && (
                  <button onClick={() => removePhone(i)} className="p-1.5 rounded transition-colors"
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
            Chaque destinataire recevra {selectedMatches.length} SMS.
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button icon={<Send size={13} />} onClick={handleSend} loading={sending} disabled={!validPhones.length}>
            Envoyer {validPhones.length > 0 ? `(${validPhones.length} dest.)` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Carte de match (championnats) — compact + sélectionnable ──────────────────

function LeagueMatchCard({ m, selected, onToggle }: {
  m: Match; selected: boolean; onToggle: () => void;
}) {
  const p = m.prediction;

  const fp = (p && isFootball(p)) ? p : null;
  const bp = (p && !isFootball(p)) ? p as BasketballPrediction : null;

  // Football fields
  const probH    = fp ? Math.round(fp.bsd_prob_home) : null;
  const probD    = fp ? Math.round(fp.bsd_prob_draw) : null;
  const probA    = fp ? Math.round(fp.bsd_prob_away) : null;
  const predicted = fp?.bsd_predicted;
  const footPickLabel = predicted === 'H'
    ? `${m.home_team} gagne`
    : predicted === 'A' ? `${m.away_team} gagne`
    : 'Match nul';
  const hasOver = fp && fp.bsd_prob_over_25 >= 55;
  const hasBtts = fp && fp.bsd_prob_btts    >= 55;

  // Basketball fields
  const bkWinner   = bp?.winner ?? '';
  const bkProbH    = bp ? Math.round(bp.prob_home * 100) : null;
  const bkProbA    = bp ? Math.round(bp.prob_away * 100) : null;
  const bkOver     = bp
    ? bp.prob_over_225 >= 0.55 ? 'Total +225'
    : bp.prob_over_215 >= 0.55 ? 'Total +215'
    : bp.prob_over_205 >= 0.55 ? 'Total +205'
    : null
    : null;
  const bkConfLabel = bp
    ? bp.confidence === 'very_high' ? 'Très haute'
    : bp.confidence === 'high'      ? 'Haute'
    : 'Faible'
    : null;
  const bkConfColor = bp
    ? bp.confidence === 'very_high' ? '#10B981'
    : bp.confidence === 'high'      ? '#F59E0B'
    : '#6B7280'
    : '#6B7280';

  return (
    <div
      className="rounded-lg px-3 py-2.5 cursor-pointer transition-all"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${selected ? ACCENT : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 1px ${ACCENT}20` : 'none',
      }}
      onClick={onToggle}
    >
      {/* Ligne 1 : checkbox + heure */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 transition-all"
          style={{ background: selected ? ACCENT : 'transparent', border: `1.5px solid ${selected ? ACCENT : 'var(--border)'}` }}>
          {selected && <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
        <span className="text-[10px] font-semibold" style={{ color: ACCENT }}>{m.kickoff}</span>
        {m.round && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>{m.round}</span>}
      </div>

      {/* Ligne 2 : équipes */}
      <p className="text-xs font-semibold leading-snug mb-2" style={{ color: 'var(--text)' }}>
        {m.home_team} <span style={{ color: 'var(--text-faint)' }}>vs</span> {m.away_team}
      </p>

      {!p && <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Pas de prono</p>}

      {/* ── Football ── */}
      {fp && (
        <>
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 mb-2">
            <span className="text-[11px] font-bold" style={{ color: ACCENT }}>{footPickLabel}</span>
            {hasOver && <span className="text-[10px] font-medium" style={{ color: '#F59E0B' }}>· +2.5</span>}
            {hasBtts && <span className="text-[10px] font-medium" style={{ color: '#8B5CF6' }}>· BTTS</span>}
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            {([
              { label: '1', prob: probH!, active: predicted === 'H', color: '#10B981' },
              { label: 'X', prob: probD!, active: predicted === 'D', color: '#6B7280' },
              { label: '2', prob: probA!, active: predicted === 'A', color: '#3B82F6' },
            ]).map(({ label, prob, active, color }) => (
              <div key={label} className="rounded py-1"
                style={{ background: active ? `${color}20` : 'transparent', border: `1px solid ${active ? `${color}50` : 'var(--border)'}` }}>
                <div className="text-[9px] leading-none" style={{ color: active ? color : 'var(--text-faint)' }}>{label}</div>
                <div className="text-[11px] font-bold leading-tight" style={{ color: active ? color : 'var(--text-muted)' }}>{prob}%</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Basketball ── */}
      {bp && (
        <>
          {/* Vainqueur + confiance + total */}
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 mb-2">
            <span className="text-[11px] font-bold" style={{ color: ACCENT }}>{bkWinner} gagne</span>
            {bkOver && <span className="text-[10px] font-medium" style={{ color: '#F59E0B' }}>· {bkOver}</span>}
            <span className="text-[10px] ml-auto font-medium" style={{ color: bkConfColor }}>
              {bkConfLabel}
            </span>
          </div>
          {/* Dom % / Ext % */}
          <div className="grid grid-cols-2 gap-1 text-center">
            {([
              { label: 'Dom.', prob: bkProbH!, active: bkWinner === m.home_team, color: '#10B981' },
              { label: 'Ext.', prob: bkProbA!, active: bkWinner === m.away_team, color: '#3B82F6' },
            ]).map(({ label, prob, active, color }) => (
              <div key={label} className="rounded py-1"
                style={{ background: active ? `${color}20` : 'transparent', border: `1px solid ${active ? `${color}50` : 'var(--border)'}` }}>
                <div className="text-[9px] leading-none" style={{ color: active ? color : 'var(--text-faint)' }}>{label}</div>
                <div className="text-[11px] font-bold leading-tight" style={{ color: active ? color : 'var(--text-muted)' }}>{prob}%</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MatchCard DB (pronostics IA — affiché seulement si data existe) ────────────

function MatchCard({ prono, sport, onSent }: { prono: SportPronostic; sport: string; onSent: () => void }) {
  const ev = prono.event;
  const mp = prono.modelProbs ?? {} as ModelProbs;
  const probHome = Math.round((mp.prob_home ?? 0) * 100);
  const probDraw = Math.round((mp.prob_draw ?? 0) * 100);
  const probAway = Math.round((mp.prob_away ?? 0) * 100);
  const xgHome = mp.xg_home != null ? mp.xg_home.toFixed(1) : null;
  const xgAway = mp.xg_away != null ? mp.xg_away.toFixed(1) : null;
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
    <div className="rounded-xl p-3 space-y-2.5"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>{ev.league}</span>
        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
          <Clock size={10} /> {ev.kickoff}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-right font-semibold truncate" style={{ color: 'var(--text)' }}>{ev.homeTeam}</span>
        <span className="flex-shrink-0 font-bold text-xs w-12 text-center"
          style={{ color: result?.homeScore != null ? ACCENT : 'var(--text-faint)' }}>
          {result?.homeScore != null ? `${result.homeScore}–${result.awayScore}` : 'vs'}
        </span>
        <span className="flex-1 text-left font-semibold truncate" style={{ color: 'var(--text)' }}>{ev.awayTeam}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center text-xs">
        {([
          { key: 'home', label: '1', prob: probHome, color: '#10B981' },
          { key: 'draw', label: 'X', prob: probDraw, color: '#6B7280' },
          { key: 'away', label: '2', prob: probAway, color: '#3B82F6' },
        ] as const).map(({ key, label, prob, color }) => (
          <div key={key} className="rounded px-1 py-1"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{label}</div>
            <div className="font-bold text-sm" style={{ color }}>{prob}%</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {winner && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#10B98115', color: '#10B981', border: '1px solid #10B98130' }}>✓ {winner.label}</span>}
        {recOver && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B30' }}>+2.5</span>}
        {recBtts && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#8B5CF615', color: '#8B5CF6', border: '1px solid #8B5CF630' }}>BTTS</span>}
        {xgHome && xgAway && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>xG {xgHome}–{xgAway}</span>}
      </div>
      <div className="flex items-center justify-between pt-1.5" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: confidenceColor(prono.confidence) }}>{prono.confidence}%</span>
          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>confiance</span>
          {prono.isSent && <Badge status="SENT" />}
        </div>
        {!prono.isSent && (
          <Button size="sm" icon={<Send size={12} />} onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
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

  const [selectedLeague, setSelectedLeague] = useState<{ id: string; name: string } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  // Sélection : Map external_id → SelectedMatch
  const [selectedMatches, setSelectedMatches] = useState<Map<string, SelectedMatch>>(new Map());

  const sportUpper = sport.toUpperCase();
  const isBasket = sportUpper === 'BASKETBALL';

  // Pour le basket, on travaille toujours sur J+1
  const targetDate = (() => {
    const d = new Date();
    if (isBasket) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const { data: pronostics = [], isLoading } = useQuery<SportPronostic[]>({
    queryKey: ['sports', sport, 'today'],
    queryFn: () => getSportPronosticsToday(sportUpper),
  });

  const { data: leaguesData } = useQuery<{ date: string; total: number; leagues: League[] }>({
    queryKey: ['sports', sport, 'leagues', targetDate],
    queryFn: () => getSportLeagues(sportUpper, targetDate),
    staleTime: 5 * 60 * 1000,
  });

  const { data: matchesData, isFetching: matchesFetching } = useQuery<{
    date: string; league_id: string; league_name: string; matches: Match[];
  }>({
    queryKey: ['sports', sport, 'matches', selectedLeague?.id, targetDate],
    queryFn: () => getSportMatches(sportUpper, selectedLeague!.id, targetDate),
    enabled: !!selectedLeague,
    staleTime: 5 * 60 * 1000,
  });

  const toggleMatch = (m: Match, leagueName: string) => {
    setSelectedMatches((prev) => {
      const next = new Map(prev);
      if (next.has(m.external_id)) next.delete(m.external_id);
      else next.set(m.external_id, buildMarket(m, leagueName));
      return next;
    });
  };

  const selectAll = (matches: Match[], leagueName: string, allSelected: boolean) => {
    setSelectedMatches((prev) => {
      const next = new Map(prev);
      matches.forEach((m) => {
        if (allSelected) next.delete(m.external_id);
        else next.set(m.external_id, buildMarket(m, leagueName));
      });
      return next;
    });
  };

  const byLeague = pronostics.reduce<Record<string, SportPronostic[]>>((acc, p) => {
    const league = p.event.league ?? 'Autre';
    if (!acc[league]) acc[league] = [];
    acc[league].push(p);
    return acc;
  }, {});

  const selectionArray = Array.from(selectedMatches.values());

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${ACCENT}20` }}>
            <Target size={18} style={{ color: ACCENT }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
              Pronostics {sport.charAt(0).toUpperCase() + sport.slice(1).toLowerCase()}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
            </p>
          </div>
        </div>
      </div>

      {/* Championnats + matchs */}
      {leaguesData && leaguesData.leagues.length > 0 && (
        <div className="rounded-xl p-4 space-y-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
              Championnats disponibles
            </p>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${ACCENT}20`, color: ACCENT }}>{leaguesData.total}</span>
          </div>

          {/* Pills des ligues */}
          <div className="flex flex-wrap gap-2">
            {leaguesData.leagues.map((l: League) => {
              const isSel = selectedLeague?.id === l.league_id;
              return (
                <button key={l.league_id}
                  onClick={() => setSelectedLeague(isSel ? null : { id: l.league_id, name: l.league_name })}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all"
                  style={{
                    background: isSel ? ACCENT : `${ACCENT}15`,
                    color: isSel ? '#fff' : ACCENT,
                    border: `1px solid ${isSel ? ACCENT : `${ACCENT}30`}`,
                  }}>
                  {l.league_name}
                  {l.country && <span className="opacity-60">{l.country}</span>}
                  <span className="text-[10px] font-bold px-1 py-0.5 rounded-full"
                    style={{ background: isSel ? 'rgba(255,255,255,0.25)' : `${ACCENT}30` }}>
                    {l.match_count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Matchs du championnat sélectionné */}
          {selectedLeague && (
            <div className="pt-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {selectedLeague.name}
                  </p>
                  {matchesData && matchesData.matches.length > 0 && (
                    <button
                      className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
                      style={{ color: 'var(--text-faint)', border: '1px solid var(--border)' }}
                      onClick={() => {
                        const matches = matchesData.matches;
                        const allSel  = matches.every((m) => selectedMatches.has(m.external_id));
                        selectAll(matches, selectedLeague.name, allSel);
                      }}>
                      {matchesData.matches.every((m) => selectedMatches.has(m.external_id))
                        ? 'Tout désélect.' : 'Tout sélect.'}
                    </button>
                  )}
                </div>
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
                  {matchesData.matches.map((m) => (
                    <LeagueMatchCard
                      key={m.external_id}
                      m={m}
                      selected={selectedMatches.has(m.external_id)}
                      onToggle={() => toggleMatch(m, selectedLeague.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pronostics DB (affichés seulement si présents) */}
      {!isLoading && pronostics.length > 0 && (
        <div className="space-y-6">
          {Object.entries(byLeague).map(([league, matches]) => (
            <div key={league}>
              <h2 className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: 'var(--text-faint)' }}>
                {league} · {matches.length} match{matches.length > 1 ? 's' : ''}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {matches.map((prono) => (
                  <MatchCard key={prono.id} prono={prono} sport={sport}
                    onSent={() => queryClient.invalidateQueries({ queryKey: ['sports', sport, 'today'] })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* État vide */}
      {!isLoading && pronostics.length === 0 && !(leaguesData && leaguesData.leagues.length > 0) && (
        <div className="rounded-xl p-10 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Target size={32} className="mx-auto mb-3 opacity-30" style={{ color: ACCENT }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Aucun match Football disponible pour aujourd'hui.
          </p>
        </div>
      )}

      {/* Barre flottante */}
      <AnimatePresence>
        {selectedMatches.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 px-5 py-3 rounded-2xl shadow-xl z-50"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 320 }}>
            <CheckSquare size={16} style={{ color: ACCENT }} />
            <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>
              {selectedMatches.size} match{selectedMatches.size > 1 ? 's' : ''} sélectionné{selectedMatches.size > 1 ? 's' : ''}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setSelectedMatches(new Map())}>Effacer</Button>
            <Button size="sm" icon={<Send size={13} />} onClick={() => setSendOpen(true)}>Envoyer</Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal envoi numéros */}
      <SendToNumbersModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        selectedMatches={selectionArray}
        sport={sportUpper}
      />

    </div>
  );
}
