import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit3, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPlans, createPlan, updatePlan, deletePlan } from '../lib/api';
import { formatXOF } from '../lib/format';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

interface PlanForm { name: string; price: string; durationDays: string; description: string; }

function PlanFormModal({ plan, onClose }: { plan?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PlanForm>({
    name: plan?.name || '',
    price: String(plan?.price || ''),
    durationDays: String(plan?.durationDays || ''),
    description: plan?.description || '',
  });

  const mutation = useMutation({
    mutationFn: () => plan
      ? updatePlan(plan.id, { ...form, price: Number(form.price), durationDays: Number(form.durationDays) })
      : createPlan({ ...form, price: Number(form.price), durationDays: Number(form.durationDays) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); toast.success(plan ? 'Forfait modifié' : 'Forfait créé'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {[
        { label: 'Nom du forfait', key: 'name', placeholder: 'Mensuel' },
        { label: 'Prix (F CFA)', key: 'price', placeholder: '5000' },
        { label: 'Durée (jours)', key: 'durationDays', placeholder: '30' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
          <input placeholder={placeholder} value={(form as any)[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="input" />
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2} className="input resize-none"
          placeholder="Accès pronostics quotidiens..." />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}
          disabled={!form.name || !form.price || !form.durationDays}>
          {plan ? 'Modifier' : 'Créer'}
        </Button>
      </div>
    </div>
  );
}

export default function Plans() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);

  const { data: plans = [], isLoading } = useQuery({ queryKey: ['plans'], queryFn: getPlans });

  const deleteMutation = useMutation({
    mutationFn: deletePlan,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); toast.success('Forfait supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updatePlan(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); toast.success('Statut mis à jour'); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Forfaits</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{plans.length} forfait(s)</p>
        </div>
        <Button icon={<Plus size={14} />} onClick={() => setShowModal(true)}>Nouveau Forfait</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="skeleton h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map((plan: any) => (
            <div key={plan.id} className="card p-5 flex flex-col gap-4"
              style={{ opacity: plan.isActive ? 1 : 0.45 }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-base" style={{ color: 'var(--text)' }}>{plan.name}</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{plan.description}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditTarget(plan); setShowModal(true); }}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => toggleActive.mutate({ id: plan.id, isActive: !plan.isActive })}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: plan.isActive ? 'var(--yellow-text)' : 'var(--text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    {plan.isActive ? <Check size={14} /> : <X size={14} />}
                  </button>
                  <button onClick={() => { if (confirm('Supprimer ce forfait ?')) deleteMutation.mutate(plan.id); }}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: '#EF4444' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-1">
                <span className="text-2xl font-bold" style={{ color: 'var(--yellow-text)' }}>{formatXOF(plan.price)}</span>
                <span className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>/ {plan.durationDays}j</span>
              </div>

              <span className="text-xs" style={{ color: plan.isActive ? 'var(--yellow-text)' : 'var(--text-faint)' }}>
                {plan.isActive ? '● Actif' : '○ Inactif'}
              </span>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditTarget(null); }}
        title={editTarget ? 'Modifier le Forfait' : 'Nouveau Forfait'}>
        <PlanFormModal plan={editTarget} onClose={() => { setShowModal(false); setEditTarget(null); }} />
      </Modal>
    </div>
  );
}
