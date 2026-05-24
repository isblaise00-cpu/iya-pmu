import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Play, Send, Edit3, MapPin, Trophy, Clock, ChevronDown, ChevronUp,
  Shield, Gem, Target, Star, FileDown, ExternalLink, CheckCircle2, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getPronostics, getTodayRace, sendPronostic, updatePronostic,
  startScrapingPipeline, getScrapingJob,
} from '../lib/api';
import { formatXOF } from '../lib/format';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

type Job = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'cached' | 'error';
  step: string;
  progress: number;
  message: string;
  result?: { raceId: number; pronosticId: number; cached: boolean } | null;
  error?: string | null;
};

type StrategyKey = 'SECURITE' | 'VALEUR' | 'AUDACE' | 'RECOMMANDE';
const STRATEGY_META: Record<StrategyKey, { label: string; icon: any; color: string }> = {
  SECURITE: { label: 'Sécurité', icon: Shield, color: '#10B981' },
  VALEUR: { label: 'Valeur', icon: Gem, color: '#3B82F6' },
  AUDACE: { label: 'Audace', icon: Target, color: '#F97316' },
  RECOMMANDE: { label: 'Recommandé', icon: Star, color: 'var(--yellow)' },
};

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
        if (j.status === 'done' || j.status === 'cached' || j.status === 'error') {
          if (intervalRef.current) window.clearInterval(intervalRef.current);
          if (j.status !== 'error') setTimeout(() => onDone(), 800);
        }
      } catch (err) {
        // network blip — keep polling
      }
    };
    tick();
    intervalRef.current = window.setInterval(tick, 1500);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [open, jobId, onDone]);

  if (!open) return null;
  const pct = Math.round(((job?.progress) ?? 0) * 100);

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

        {job?.status === 'cached' && (
          <div className="card p-3 text-sm" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
            Un pronostic existe déjà pour aujourd'hui — affichage du résultat existant.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {(job?.status === 'error') && (
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProposalCard({ proposal, horses }: { proposal: any; horses: any[] }) {
  const meta = STRATEGY_META[proposal.strategy as StrategyKey] || STRATEGY_META.RECOMMANDE;
  const Icon = meta.icon;
  const horseName = (n: number) => horses.find((h) => h.number === n)?.name || `N°${n}`;
  const isReco = proposal.strategy === 'RECOMMANDE';

  return (
    <div
      className="card p-4 flex flex-col"
      style={{
        borderColor: isReco ? meta.color : 'var(--border)',
        background: isReco ? 'var(--yellow-dim)' : 'var(--bg-surface)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color: meta.color }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="ml-auto text-xs font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {proposal.confidence}/100
        </span>
      </div>
      <div className="space-y-1.5 mb-3">
        {proposal.selections.map((n: number, i: number) => (
          <div key={n} className="flex items-baseline gap-2 text-sm">
            <span className="font-bold tabular-nums w-6 text-right" style={{ color: meta.color }}>
              {i + 1}.
            </span>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>N°{n}</span>
            <span className="truncate" style={{ color: 'var(--text-muted)' }}>{horseName(n)}</span>
          </div>
        ))}
      </div>
      <div className="text-[11px] mt-auto" style={{ color: 'var(--text-muted)' }}>
        <span className="font-medium">Base:</span> N°{proposal.base}
        {proposal.outsider != null && (
          <span className="ml-3"><span className="font-medium">Outsider:</span> N°{proposal.outsider}</span>
        )}
      </div>
      <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {proposal.reasoning}
      </p>
    </div>
  );
}

function RaceHeader({ race }: { race: any }) {
  const TYPE_LABEL: Record<string, string> = {
    TIERCE: 'Tiercé', QUARTE: 'Quarté', QUARTE_PLUS: 'Quarté+', QUINTE_PLUS: 'Quinté+',
    COUPLE: 'Couplé', AUTRE: 'Course',
  };
  const DISC_LABEL: Record<string, string> = {
    TROT_ATTELE: 'Trot Attelé', TROT_MONTE: 'Trot Monté', PLAT: 'Plat', OBSTACLE: 'Obstacle', AUTRE: 'Course',
  };
  return (
    <div className="card p-5" style={{ background: 'var(--yellow-dim)', borderColor: 'var(--yellow)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide font-bold" style={{ color: 'var(--yellow-text)' }}>
          {TYPE_LABEL[race.raceType] ?? race.raceType} · {DISC_LABEL[race.discipline] ?? race.discipline}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {format(new Date(race.date), 'EEEE d MMMM yyyy', { locale: fr })}
        </span>
      </div>
      <h2 className="text-2xl font-bold mb-1 leading-tight" style={{ color: 'var(--text)' }}>
        {race.raceName}
      </h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="flex items-center gap-1"><MapPin size={12} /> {race.hippodrome}</span>
        <span>{race.distance.toLocaleString('fr-FR')} m</span>
        <span>{race.numHorses} partants</span>
        {race.allocationXof != null && (
          <span className="flex items-center gap-1"><Trophy size={12} /> {formatXOF(race.allocationXof)}</span>
        )}
        {race.startTime && (
          <span className="flex items-center gap-1">
            <Clock size={12} /> Départ {format(new Date(race.startTime), 'HH:mm')}
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

function HorsesTable({ horses, favoris, outsiders, bigOutsiders }:
  { horses: any[]; favoris?: number[]; outsiders?: number[]; bigOutsiders?: number[] }) {
  const inSet = (n: number, s?: number[]) => Array.isArray(s) && s.includes(n);
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
              {['N°', 'Cheval', 'Driver', 'Entraîneur', 'S/Âge', 'Perf', 'Gains', 'P.Turf', 'Tiercé Mag.'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-muted)', fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {horses.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-3 py-2 font-bold tabular-nums">
                  <span style={{ color: inSet(h.number, favoris) ? 'var(--yellow-text)' : 'var(--text)' }}>
                    {h.number}
                  </span>
                  {inSet(h.number, favoris) && <span className="ml-1" style={{ color: 'var(--yellow)' }}>★</span>}
                  {(inSet(h.number, outsiders) || inSet(h.number, bigOutsiders)) && (
                    <span className="ml-1 text-[9px]" style={{ color: '#F97316' }}>
                      {inSet(h.number, bigOutsiders) ? 'GO' : 'O'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-medium" style={{ color: 'var(--text)' }}>{h.name}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{h.driver || '—'}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{h.trainer || '—'}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {h.sex || ''}{h.age ? `.${h.age}` : ''}
                </td>
                <td className="px-3 py-2 tabular-nums font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {h.recentPerf || '—'}
                </td>
                <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-muted)' }}>
                  {h.gainsXof != null ? formatXOF(h.gainsXof) : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>{h.oddsParisTurf || '—'}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>{h.oddsTierceMag || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourcesPanel({ pronostic }: { pronostic: any }) {
  const sourcesPdf = pronostic?.sourcesPdf as Record<string, number[]> | null;
  const externalSources = pronostic?.rawData?.external?.sources as Array<{ name: string; ok: boolean; url: string; matched: number[] }> | undefined;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Pronostics du PDF (6 publications)
        </h3>
        {!sourcesPdf || Object.keys(sourcesPdf).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>—</p>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(sourcesPdf).map(([name, nums]) => (
              <div key={name} className="flex items-baseline gap-2 text-xs">
                <span className="font-medium w-32 shrink-0" style={{ color: 'var(--text)' }}>{name}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {(nums as number[]).join(' - ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Sites externes consultés
        </h3>
        {!externalSources || externalSources.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>—</p>
        ) : (
          <div className="space-y-1.5">
            {externalSources.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                {s.ok
                  ? <CheckCircle2 size={12} style={{ color: '#10B981' }} />
                  : <XCircle size={12} style={{ color: '#EF4444' }} />
                }
                <a href={s.url} target="_blank" rel="noreferrer"
                  className="font-medium hover:underline flex items-center gap-1"
                  style={{ color: 'var(--text)' }}>
                  {s.name} <ExternalLink size={10} style={{ color: 'var(--text-faint)' }} />
                </a>
                <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
                  {s.ok ? `${s.matched.length} cheval(aux) trouvé(s)` : 'indisponible'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClassementsPanel({ pronostic }: { pronostic: any }) {
  const parsed = pronostic?.rawData?.parsed;
  if (!parsed) return null;
  const apt = parsed.aptitudes || {};
  const sections = [
    { label: 'Forme', items: apt.forme, color: '#10B981' },
    { label: 'Classe', items: apt.classe, color: '#3B82F6' },
    { label: 'Progrès', items: apt.progres, color: '#8B5CF6' },
    { label: 'Régularité', items: apt.regularite, color: 'var(--yellow-text)' },
    { label: 'Outsiders', items: parsed.outsiders, color: '#F97316' },
    { label: 'Gros Outsiders', items: parsed.bigOutsiders, color: '#EF4444' },
  ];
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
        Classements & aptitudes
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {sections.map(({ label, items, color }) => (
          items && items.length > 0 && (
            <div key={label}>
              <p className="text-[11px] font-semibold mb-1" style={{ color }}>{label}</p>
              <p className="text-xs tabular-nums" style={{ color: 'var(--text)' }}>
                {(items as number[]).join(' - ')}
              </p>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function EditModal({ pronostic, onClose }: { pronostic: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    baseHorse: pronostic.baseHorse || '',
    tierce: (Array.isArray(pronostic.tierce) ? pronostic.tierce : []).join(', '),
    quarte: (Array.isArray(pronostic.quarte) ? pronostic.quarte : []).join(', '),
    quinte: (Array.isArray(pronostic.quinte) ? pronostic.quinte : []).join(', '),
    outsider: pronostic.outsider || '',
    confidenceScore: pronostic.confidenceScore || 0,
    commentary: pronostic.commentary || '',
  });

  const mutation = useMutation({
    mutationFn: () => updatePronostic(pronostic.id, {
      ...form,
      tierce: form.tierce.split(',').map((s: string) => s.trim()).filter(Boolean),
      quarte: form.quarte.split(',').map((s: string) => s.trim()).filter(Boolean),
      quinte: form.quinte.split(',').map((s: string) => s.trim()).filter(Boolean),
      confidenceScore: Number(form.confidenceScore),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pronostics'] });
      qc.invalidateQueries({ queryKey: ['todayRace'] });
      toast.success('Pronostic modifié');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {[
        ['Cheval de base', 'baseHorse', ''],
        ['Tiercé', 'tierce', 'Ex: N°3, N°7, N°11'],
        ['Quarté', 'quarte', 'Ex: N°3, N°7, N°11, N°5'],
        ['Quinté', 'quinte', 'Ex: N°3, N°7, N°11, N°5, N°14'],
        ['Outsider', 'outsider', ''],
        ['Score de confiance (0-100)', 'confidenceScore', ''],
      ].map(([label, key, hint]) => (
        <div key={key}>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
          <input
            type={key === 'confidenceScore' ? 'number' : 'text'}
            value={(form as any)[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="input"
          />
          {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Commentaire</label>
        <textarea value={form.commentary}
          onChange={(e) => setForm({ ...form, commentary: e.target.value })}
          rows={4} className="input resize-none" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>Sauvegarder</Button>
      </div>
    </div>
  );
}

export default function Pronostics() {
  const qc = useQueryClient();
  const [scrapingJob, setScrapingJob] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [historyExpanded, setHistoryExpanded] = useState<number | null>(null);

  const { data: today, isLoading: todayLoading } = useQuery({ queryKey: ['todayRace'], queryFn: getTodayRace });
  const { data: history = [], isLoading: historyLoading } = useQuery({ queryKey: ['pronostics'], queryFn: getPronostics });

  const startMutation = useMutation({
    mutationFn: startScrapingPipeline,
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

  const onPipelineDone = () => {
    setScrapingJob(null);
    qc.invalidateQueries({ queryKey: ['todayRace'] });
    qc.invalidateQueries({ queryKey: ['pronostics'] });
    toast.success('Pronostic du jour disponible');
  };

  const race = today?.race;
  const pronostic = today?.pronostic || race?.pronostic;
  const proposals = (pronostic?.proposals as any[] | null | undefined) || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Pronostics du jour</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Source officielle : LONAB Burkina Faso
          </p>
        </div>
        <div className="flex gap-2">
          {pronostic && !pronostic.isSent && (
            <Button icon={<Send size={14} />} loading={sendMutation.isPending}
              onClick={() => sendMutation.mutate(pronostic.id)}>
              Envoyer aux abonnés
            </Button>
          )}
          <Button
            variant={race ? 'secondary' : 'primary'}
            icon={<Play size={14} />}
            loading={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            {race ? 'Régénérer' : 'Lancer le pipeline'}
          </Button>
        </div>
      </div>

      {/* Today's race */}
      {todayLoading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      ) : !race ? (
        <div className="card p-12 text-center">
          <Trophy size={32} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
            Aucun pronostic pour aujourd'hui
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Cliquez sur « Lancer le pipeline » pour télécharger le programme officiel LONAB,
            recouper les sources et générer les propositions IA.
          </p>
        </div>
      ) : (
        <>
          <RaceHeader race={race} />

          {/* Proposals */}
          {proposals.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {proposals.map((p: any) => (
                <ProposalCard key={p.strategy} proposal={p} horses={race.horses || []} />
              ))}
            </div>
          )}

          {/* Global commentary */}
          {pronostic?.commentary && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                Synthèse de l'IA
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text)' }}>
                {pronostic.commentary}
              </p>
              <div className="flex items-center gap-2 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <span>Confiance globale: <span className="font-bold" style={{ color: 'var(--yellow-text)' }}>{pronostic.confidenceScore}/100</span></span>
                {pronostic.modifiedByAdmin && <Badge status="PENDING" />}
                {pronostic.isSent && <Badge status="SENT" />}
                <button className="ml-auto inline-flex items-center gap-1 hover:underline"
                  onClick={() => setEditTarget(pronostic)}>
                  <Edit3 size={11} /> Ajuster
                </button>
              </div>
            </div>
          )}

          {/* Horses table */}
          {race.horses && race.horses.length > 0 && (
            <HorsesTable
              horses={race.horses}
              favoris={(pronostic?.rawData?.parsed?.favoris) || []}
              outsiders={(pronostic?.rawData?.parsed?.outsiders) || []}
              bigOutsiders={(pronostic?.rawData?.parsed?.bigOutsiders) || []}
            />
          )}

          {/* Sources */}
          {pronostic && <SourcesPanel pronostic={pronostic} />}
          {pronostic && <ClassementsPanel pronostic={pronostic} />}
        </>
      )}

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Historique
        </h2>
        {historyLoading ? (
          <div className="skeleton h-12 w-full" />
        ) : history.length <= 1 ? (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Aucun pronostic antérieur.</p>
        ) : (
          <div className="space-y-1.5">
            {history.filter((p: any) => p.id !== pronostic?.id).map((p: any) => (
              <div key={p.id} className="card overflow-hidden">
                <div className="flex items-center justify-between p-3 cursor-pointer transition-colors"
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  onClick={() => setHistoryExpanded(historyExpanded === p.id ? null : p.id)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                      {p.race?.raceName || p.baseHorse || `Pronostic #${p.id}`}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {format(new Date(p.date), 'dd/MM/yyyy', { locale: fr })}
                      {p.race && ` · ${p.race.hippodrome}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--yellow-text)' }}>
                      {p.confidenceScore}/100
                    </span>
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
                      <div className="px-3 pb-3 pt-1 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                        <p style={{ color: 'var(--text-muted)' }}>
                          <span className="font-medium">Base:</span> {p.baseHorse || '—'} · <span className="font-medium">Outsider:</span> {p.outsider || '—'}
                        </p>
                        <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                          <span className="font-medium">Tiercé:</span> {Array.isArray(p.tierce) ? p.tierce.join(' — ') : '—'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      <ScrapingProgressModal
        open={!!scrapingJob}
        jobId={scrapingJob}
        onDone={onPipelineDone}
        onClose={() => setScrapingJob(null)}
      />

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Ajuster le pronostic" size="lg">
        {editTarget && <EditModal pronostic={editTarget} onClose={() => setEditTarget(null)} />}
      </Modal>
    </div>
  );
}
