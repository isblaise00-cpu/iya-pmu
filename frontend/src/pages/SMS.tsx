import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Send, MessageSquare, FileText, Pencil, Trash2, Copy, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getSmsCampaigns, createSmsCampaign, sendSmsCampaign, getSmsLogs,
  getSmsTemplates, createSmsTemplate, updateSmsTemplate, deleteSmsTemplate,
  resendSmsLog,
} from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

// ── Catégories de modèles ────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'bienvenue',  label: 'Bienvenue',  color: '#10B981' },
  { value: 'prono',      label: 'Pronostic',  color: '#F59E0B' },
  { value: 'promotion',  label: 'Promotion',  color: '#8B5CF6' },
  { value: 'resultat',   label: 'Résultat',   color: '#3B82F6' },
  { value: 'expiration', label: 'Expiration', color: '#EF4444' },
  { value: 'general',    label: 'Général',    color: '#6B7280' },
];

function categoryMeta(value: string) {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

// ── Modal Modèle (création + édition) ────────────────────────────────────────

interface TemplateModalProps {
  initial?: any;
  onClose: () => void;
}

function TemplateModal({ initial, onClose }: TemplateModalProps) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name:     initial?.name     ?? '',
    category: initial?.category ?? 'general',
    message:  initial?.message  ?? '',
  });

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? updateSmsTemplate(initial.id, form)
        : createSmsTemplate(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast.success(isEdit ? 'Modèle mis à jour' : 'Modèle créé');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const charCount  = form.message.length;
  const smsCount   = Math.ceil(charCount / 160) || 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Nom du modèle
        </label>
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Ex: Bienvenue nouvel abonné"
          className="input"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Catégorie
        </label>
        <select value={form.category} onChange={(e) => set('category', e.target.value)} className="input">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex justify-between mb-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Message</label>
          <span className="text-xs" style={{ color: charCount > 160 ? '#EF4444' : 'var(--text-faint)' }}>
            {charCount} car. · {smsCount} SMS
          </span>
        </div>
        <textarea
          value={form.message}
          onChange={(e) => set('message', e.target.value)}
          rows={8}
          placeholder="Contenu du message SMS..."
          className="input resize-none font-mono text-xs"
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          160 car. = 1 SMS (GSM7). Les accents passent en UCS2 → 70 car./SMS.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          disabled={!form.name || !form.message}
        >
          {isEdit ? 'Enregistrer' : 'Créer'}
        </Button>
      </div>
    </div>
  );
}

// ── Modal Nouvelle Campagne ───────────────────────────────────────────────────

interface NewCampaignModalProps {
  onClose: () => void;
  initialMessage?: string;
  initialName?: string;
}

function NewCampaignModal({ onClose, initialMessage = '', initialName = '' }: NewCampaignModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: initialName, message: initialMessage, target: 'all' });
  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const mutation = useMutation({
    mutationFn: () => createSmsCampaign(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
      toast.success('Campagne créée');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const charCount = form.message.length;
  const smsCount  = Math.ceil(charCount / 160) || 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Nom de la campagne
        </label>
        <input
          placeholder="Pronostics du lundi"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className="input"
        />
      </div>
      <div>
        <div className="flex justify-between mb-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Message</label>
          <span className="text-xs" style={{ color: charCount > 160 ? '#EF4444' : 'var(--text-faint)' }}>
            {charCount} car. · {smsCount} SMS
          </span>
        </div>
        <textarea
          value={form.message}
          onChange={(e) => set('message', e.target.value)}
          rows={6}
          placeholder="Votre message SMS..."
          className="input resize-none font-mono text-xs"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Cible</label>
        <select value={form.target} onChange={(e) => set('target', e.target.value)} className="input">
          <option value="all">Tous les abonnés</option>
          <option value="active">Actifs uniquement</option>
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          disabled={!form.name || !form.message}
        >
          Créer la campagne
        </Button>
      </div>
    </div>
  );
}

// ── Onglet Modèles ────────────────────────────────────────────────────────────

function TemplatesTab({ onUse }: { onUse: (tpl: any) => void }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [filterCat, setFilterCat] = useState('');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['sms-templates'], queryFn: getSmsTemplates,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSmsTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-templates'] }); toast.success('Modèle supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = filterCat
    ? (templates as any[]).filter((t: any) => t.category === filterCat)
    : (templates as any[]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterCat('')}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              background: !filterCat ? 'var(--yellow)' : 'var(--bg-card)',
              color: !filterCat ? '#000' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            Tous
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setFilterCat(filterCat === c.value ? '' : c.value)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{
                background: filterCat === c.value ? c.color + '22' : 'var(--bg-card)',
                color: filterCat === c.value ? c.color : 'var(--text-muted)',
                border: `1px solid ${filterCat === c.value ? c.color : 'var(--border)'}`,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>
            Nouveau modèle
          </Button>
        </div>
      </div>

      {/* Grille de cartes */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-48" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={28} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {filterCat ? 'Aucun modèle dans cette catégorie' : 'Aucun modèle — créez-en un'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((tpl: any) => {
            const cat = categoryMeta(tpl.category);
            const chars = tpl.message.length;
            const sms   = Math.ceil(chars / 160) || 1;
            return (
              <div key={tpl.id} className="card p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {tpl.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: cat.color + '22', color: cat.color }}
                      >
                        {cat.label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {chars} car. · {sms} SMS
                      </span>
                    </div>
                  </div>
                </div>

                {/* Aperçu du message */}
                <div
                  className="rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap flex-1"
                  style={{
                    background: 'var(--bg)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    fontFamily: 'monospace',
                    maxHeight: '120px',
                    overflowY: 'auto',
                  }}
                >
                  {tpl.message}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    icon={<Copy size={12} />}
                    onClick={() => onUse(tpl)}
                    style={{ flex: 1 }}
                  >
                    Utiliser
                  </Button>
                  <button
                    onClick={() => setEditing(tpl)}
                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                    title="Modifier"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Supprimer "${tpl.name}" ?`)) deleteMutation.mutate(tpl.id);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                    style={{
                      background: 'var(--bg)',
                      color: '#EF4444',
                      border: '1px solid var(--border)',
                    }}
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouveau modèle SMS">
        <TemplateModal onClose={() => setShowCreate(false)} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Modifier le modèle">
        {editing && <TemplateModal initial={editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

// ── Page principale SMS ───────────────────────────────────────────────────────

type Tab = 'campaigns' | 'templates' | 'logs';

export default function SMS() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('campaigns');
  const [showNew, setShowNew] = useState(false);
  const [campaignInit, setCampaignInit] = useState<{ message: string; name: string } | null>(null);

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ['sms-campaigns'], queryFn: getSmsCampaigns,
  });
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['sms-logs'], queryFn: getSmsLogs,
  });

  const sendMutation = useMutation({
    mutationFn: sendSmsCampaign,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sms-campaigns'] });
      qc.invalidateQueries({ queryKey: ['sms-logs'] });
      toast.success(`Envoyé à ${data.sent}/${data.total} abonné(s)`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resendMutation = useMutation({
    mutationFn: resendSmsLog,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sms-logs'] });
      if (data.success) toast.success('SMS renvoyé avec succès');
      else toast.error(`Échec : ${data.error}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleUseTemplate = (tpl: any) => {
    setCampaignInit({ message: tpl.message, name: tpl.name });
    setActiveTab('campaigns');
    setShowNew(true);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'campaigns',  label: 'Campagnes' },
    { key: 'templates',  label: 'Modèles' },
    { key: 'logs',       label: "Logs d'envoi" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>SMS</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Campagnes, modèles et logs d'envoi
          </p>
        </div>
        {activeTab === 'campaigns' && (
          <Button icon={<Plus size={14} />} onClick={() => { setCampaignInit(null); setShowNew(true); }}>
            Nouvelle Campagne
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-fit" style={{ borderBottom: '1px solid var(--border)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? 'var(--yellow-text)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--yellow)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Campagnes ─────────────────────────────────────────────────────── */}
      {activeTab === 'campaigns' && (
        <div className="space-y-2">
          {campaignsLoading ? (
            [1,2].map(i => <div key={i} className="skeleton h-16" />)
          ) : (campaigns as any[]).length === 0 ? (
            <div className="card p-12 text-center">
              <MessageSquare size={28} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucune campagne</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Créez-en une ou utilisez un modèle depuis l'onglet Modèles
              </p>
            </div>
          ) : (
            (campaigns as any[]).map((c: any) => (
              <div key={c.id} className="card p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{c.name}</p>
                    <Badge status={c.status} />
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.message}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    Cible: {c.target === 'all' ? 'Tous' : 'Actifs'} ·
                    {c.sentAt
                      ? ` Envoyée le ${format(new Date(c.sentAt), 'dd/MM/yyyy HH:mm', { locale: fr })}`
                      : ' Non envoyée'}
                    · {c._count?.logs ?? 0} log(s)
                  </p>
                </div>
                {c.status !== 'SENT' && (
                  <Button
                    size="sm"
                    icon={<Send size={13} />}
                    loading={sendMutation.isPending}
                    onClick={() => sendMutation.mutate(c.id)}
                  >
                    Envoyer
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Modèles ───────────────────────────────────────────────────────── */}
      {activeTab === 'templates' && (
        <TemplatesTab onUse={handleUseTemplate} />
      )}

      {/* ── Logs ──────────────────────────────────────────────────────────── */}
      {activeTab === 'logs' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Abonné', 'Téléphone', 'Message', 'Statut', 'Campagne', 'Date', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  [1,2,3].map(i => (
                    <tr key={i}>
                      {[1,2,3,4,5,6].map(j => (
                        <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-16" /></td>
                      ))}
                    </tr>
                  ))
                ) : (logs as any[]).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                      Aucun log
                    </td>
                  </tr>
                ) : (
                  (logs as any[]).map((log: any) => (
                    <tr
                      key={log.id}
                      style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text)' }}>
                        {log.subscriber?.name || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {log.subscriber?.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>
                        {log.message}
                      </td>
                      <td className="px-4 py-3"><Badge status={log.status} /></td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {log.campaign?.name || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                        {format(new Date(log.sentAt), 'dd/MM HH:mm', { locale: fr })}
                      </td>
                      <td className="px-4 py-3">
                        {log.status === 'FAILED' && (
                          <button
                            onClick={() => resendMutation.mutate(log.id)}
                            disabled={resendMutation.isPending}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                            style={{ color: '#F59E0B', border: '1px solid #F59E0B40', background: '#F59E0B10' }}
                          >
                            <RotateCcw size={11} />
                            Renvoyer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal campagne */}
      <Modal
        open={showNew}
        onClose={() => { setShowNew(false); setCampaignInit(null); }}
        title="Nouvelle Campagne SMS"
      >
        <NewCampaignModal
          onClose={() => { setShowNew(false); setCampaignInit(null); }}
          initialMessage={campaignInit?.message}
          initialName={campaignInit?.name}
        />
      </Modal>
    </div>
  );
}
