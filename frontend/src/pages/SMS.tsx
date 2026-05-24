import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Send, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSmsCampaigns, createSmsCampaign, sendSmsCampaign, getSmsLogs } from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', message: '', target: 'all' });

  const mutation = useMutation({
    mutationFn: () => createSmsCampaign(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sms-campaigns'] }); toast.success('Campagne créée'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const charCount = form.message.length;
  const smsCount = Math.ceil(charCount / 160) || 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Nom de la campagne</label>
        <input placeholder="Pronostics du lundi" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input" />
      </div>
      <div>
        <div className="flex justify-between mb-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Message</label>
          <span className="text-xs" style={{ color: charCount > 160 ? '#EF4444' : 'var(--text-faint)' }}>
            {charCount} car. · {smsCount} SMS
          </span>
        </div>
        <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={5} placeholder="Votre message SMS..." className="input resize-none" />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Cible</label>
        <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="input">
          <option value="all">Tous les abonnés</option>
          <option value="active">Actifs uniquement</option>
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}
          disabled={!form.name || !form.message}>
          Créer
        </Button>
      </div>
    </div>
  );
}

export default function SMS() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'logs'>('campaigns');

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>SMS</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Campagnes et logs d'envoi</p>
        </div>
        <Button icon={<Plus size={14} />} onClick={() => setShowNew(true)}>Nouvelle Campagne</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 w-fit" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['campaigns', 'logs'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: activeTab === tab ? 'var(--yellow-text)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--yellow)' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
            {tab === 'campaigns' ? 'Campagnes' : "Logs d'envoi"}
          </button>
        ))}
      </div>

      {activeTab === 'campaigns' && (
        <div className="space-y-2">
          {campaignsLoading ? (
            [1,2].map(i => <div key={i} className="skeleton h-16" />)
          ) : campaigns.length === 0 ? (
            <div className="card p-12 text-center">
              <MessageSquare size={28} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucune campagne</p>
            </div>
          ) : (
            campaigns.map((c: any) => (
              <div key={c.id} className="card p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{c.name}</p>
                    <Badge status={c.status} />
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.message}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    Cible: {c.target === 'all' ? 'Tous' : 'Actifs'} ·
                    {c.sentAt ? ` Envoyée le ${format(new Date(c.sentAt), 'dd/MM/yyyy HH:mm', { locale: fr })}` : ' Non envoyée'}
                    · {c._count?.logs ?? 0} log(s)
                  </p>
                </div>
                {c.status !== 'SENT' && (
                  <Button size="sm" icon={<Send size={13} />}
                    loading={sendMutation.isPending}
                    onClick={() => sendMutation.mutate(c.id)}>
                    Envoyer
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Abonné', 'Téléphone', 'Message', 'Statut', 'Campagne', 'Date'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  [1,2,3].map(i => (
                    <tr key={i}>{[1,2,3,4,5,6].map(j => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-16" /></td>
                    ))}</tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>Aucun log</td></tr>
                ) : (
                  logs.map((log: any) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text)' }}>{log.subscriber?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{log.subscriber?.phone || '—'}</td>
                      <td className="px-4 py-3 text-sm max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>{log.message}</td>
                      <td className="px-4 py-3"><Badge status={log.status} /></td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{log.campaign?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                        {format(new Date(log.sentAt), 'dd/MM HH:mm', { locale: fr })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nouvelle Campagne SMS">
        <NewCampaignModal onClose={() => setShowNew(false)} />
      </Modal>
    </div>
  );
}
