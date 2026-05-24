import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Clock, Key, MessageSquare, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSettings, updateSettings } from '../lib/api';
import Button from '../components/ui/Button';

interface SettingsForm {
  scraping_time: string;
  results_fetch_time: string;
  anthropic_model: string;
  sms_default_prono: string;
  sms_expired: string;
  sms_unknown: string;
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
        <Icon size={16} style={{ color: 'var(--yellow)' }} />
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const [form, setForm] = useState<SettingsForm>({
    scraping_time: '07:00',
    results_fetch_time: '18:00',
    anthropic_model: 'claude-sonnet-4-20250514',
    sms_default_prono: '',
    sms_expired: '',
    sms_unknown: '',
  });

  useEffect(() => {
    if (settings) {
      setForm({
        scraping_time: settings.scraping_time || '07:00',
        results_fetch_time: settings.results_fetch_time || '18:00',
        anthropic_model: settings.anthropic_model || 'claude-sonnet-4-20250514',
        sms_default_prono: settings.sms_default_prono || '',
        sms_expired: settings.sms_expired || '',
        sms_unknown: settings.sms_unknown || '',
      });
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () => updateSettings(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Paramètres sauvegardés'); },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (key: keyof SettingsForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        {[1,2,3].map(i => <div key={i} className="skeleton h-36" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Paramètres</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Configuration de la plateforme</p>
        </div>
        <Button icon={<Save size={14} />} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Sauvegarder
        </Button>
      </div>

      <Section icon={Clock} title="Planification automatique">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Heure du scraping</label>
            <input type="time" value={form.scraping_time} onChange={set('scraping_time')} className="input" />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Génération automatique des pronostics</p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Heure récupération résultats</label>
            <input type="time" value={form.results_fetch_time} onChange={set('results_fetch_time')} className="input" />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Récupération automatique des résultats</p>
          </div>
        </div>
      </Section>

      <Section icon={Key} title="Configuration IA">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Modèle Claude (Anthropic)</label>
          <select value={form.anthropic_model} onChange={set('anthropic_model')} className="input">
            <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514 (Recommandé)</option>
            <option value="claude-opus-4-5">claude-opus-4-5</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Clé API configurable via ANTHROPIC_API_KEY
          </p>
        </div>
      </Section>

      <Section icon={MessageSquare} title="Modèles SMS">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            SMS Pronostic du jour
            <span className="ml-2 font-normal" style={{ color: 'var(--text-faint)' }}>
              {'{date}'} {'{base}'} {'{tierce}'} {'{quarte}'} {'{quinte}'} {'{outsider}'} {'{score}'}
            </span>
          </label>
          <textarea value={form.sms_default_prono} onChange={set('sms_default_prono')}
            rows={5} className="input resize-none" />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            {form.sms_default_prono.length} car. · {Math.ceil(form.sms_default_prono.length / 160) || 0} SMS
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>SMS abonné expiré</label>
          <textarea value={form.sms_expired} onChange={set('sms_expired')} rows={3} className="input resize-none" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>SMS numéro non reconnu</label>
          <textarea value={form.sms_unknown} onChange={set('sms_unknown')} rows={3} className="input resize-none" />
        </div>
      </Section>

      <Section icon={Shield} title="Commandes SMS abonnés">
        <div className="space-y-0">
          {[
            { cmd: 'PRONO', desc: 'Reçoit le pronostic du jour' },
            { cmd: 'RESULTAT', desc: 'Reçoit le dernier résultat de course' },
            { cmd: 'SOLDE', desc: 'Consulte les jours restants d\'abonnement' },
            { cmd: 'AIDE', desc: 'Liste toutes les commandes disponibles' },
          ].map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-center gap-4 py-2.5"
              style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="font-mono text-xs px-2 py-1 rounded"
                style={{ background: 'var(--yellow-dim)', color: 'var(--yellow-text)', border: '1px solid var(--yellow)' }}>
                {cmd}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button icon={<Save size={14} />} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Sauvegarder les paramètres
        </Button>
      </div>
    </div>
  );
}
