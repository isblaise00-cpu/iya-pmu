import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Search, Trash2, Receipt, Pencil, Ban, RotateCcw, UserX, X, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSubscribers, getPlans, createSubscriber, updateSubscriber, deleteSubscriber, getSubscriberPayments } from '../lib/api';
import { formatXOF } from '../lib/format';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

function AddSubscriberModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: getPlans });
  const [form, setForm] = useState({ phone: '', name: '', planId: '', note: '' });

  const mutation = useMutation({
    mutationFn: () => createSubscriber({ ...form, planId: Number(form.planId) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscribers'] }); toast.success('Abonné ajouté'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {[
        { label: 'Nom complet', key: 'name', type: 'text', placeholder: 'Jean Dupont' },
        { label: 'Téléphone', key: 'phone', type: 'tel', placeholder: '+221770000000' },
        { label: 'Note de paiement', key: 'note', type: 'text', placeholder: 'Paiement initial' },
      ].map(({ label, key, type, placeholder }) => (
        <div key={key}>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
          <input type={type} placeholder={placeholder} value={(form as any)[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="input" />
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Forfait</label>
        <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} className="input">
          <option value="">Sélectionner un forfait</option>
          {plans.filter((p: any) => p.isActive).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name} — {formatXOF(p.price)} / {p.durationDays}j</option>
          ))}
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}
          disabled={!form.name || !form.phone || !form.planId}>
          Ajouter
        </Button>
      </div>
    </div>
  );
}

function EditSubscriberModal({ subscriber, onClose }: { subscriber: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: getPlans });
  const [form, setForm] = useState({
    name: subscriber.name || '',
    phone: subscriber.phone || '',
    planId: String(subscriber.planId || ''),
    endDate: subscriber.endDate ? new Date(subscriber.endDate).toISOString().slice(0, 10) : '',
  });

  const mutation = useMutation({
    mutationFn: () => updateSubscriber(subscriber.id, {
      name: form.name,
      phone: form.phone,
      planId: Number(form.planId),
      endDate: form.endDate || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscribers'] }); toast.success('Abonné modifié'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Nom complet</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Téléphone</label>
        <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Forfait</label>
        <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} className="input">
          {plans.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name} — {formatXOF(p.price)} / {p.durationDays}j</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Date d'expiration</label>
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="input" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}
          disabled={!form.name || !form.phone || !form.planId}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

function PaymentsModal({ subscriber, onClose }: { subscriber: any; onClose: () => void }) {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments', subscriber.id],
    queryFn: () => getSubscriberPayments(subscriber.id),
  });

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Historique de {subscriber.name}</p>
      {isLoading ? (
        <div className="skeleton h-32 w-full" />
      ) : payments.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-faint)' }}>Aucun paiement</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between card p-3">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{formatXOF(p.amount)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.plan?.name} — {p.note || '—'}</p>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {format(new Date(p.paymentDate), 'dd/MM/yyyy', { locale: fr })}
              </p>
            </div>
          ))}
        </div>
      )}
      <Button variant="secondary" className="mt-4" onClick={onClose}>Fermer</Button>
    </div>
  );
}

function ActionButton({
  onClick, color, title, children,
}: { onClick: () => void; color: string; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded transition-colors"
      style={{ color }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

export default function Subscribers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [paymentsFor, setPaymentsFor] = useState<any>(null);

  const { data: subscribers = [], isLoading } = useQuery({
    queryKey: ['subscribers', search, statusFilter],
    queryFn: () => getSubscribers({ search: search || undefined, status: statusFilter || undefined }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSubscriber,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscribers'] }); toast.success('Abonné désabonné et supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateSubscriber(id, { status }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['subscribers'] });
      const labels: Record<string, string> = { ACTIVE: 'réactivé', SUSPENDED: 'suspendu', EXPIRED: 'désabonné' };
      toast.success(`Abonné ${labels[vars.status] ?? 'modifié'}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDelete = (s: any) => {
    const msg = s.status === 'ACTIVE'
      ? `Cet abonné est ACTIF. Il sera désabonné puis supprimé définitivement (avec ses paiements).\n\nConfirmer la suppression de ${s.name} ?`
      : `Supprimer définitivement ${s.name} et son historique de paiements ?`;
    if (confirm(msg)) deleteMutation.mutate(s.id);
  };

  const handleUnsubscribe = (s: any) => {
    if (confirm(`Désabonner ${s.name} ? Le statut passera à EXPIRÉ et il ne recevra plus de pronostics.`)) {
      updateStatus.mutate({ id: s.id, status: 'EXPIRED' });
    }
  };

  const handleRestore = (s: any) => {
    const dateStr = format(new Date(s.endDate), 'dd/MM/yyyy', { locale: fr });
    const isPastEnd = new Date(s.endDate).getTime() < Date.now();
    const msg = isPastEnd
      ? `Réactiver l'abonnement de ${s.name} ?\n\nLa date d'expiration (${dateStr}) est dépassée — pensez à la prolonger via Modifier après restauration.`
      : `Restaurer l'abonnement de ${s.name} ?\n\nLe statut repasse à ACTIF (expire le ${dateStr}).`;
    if (confirm(msg)) {
      updateStatus.mutate({ id: s.id, status: 'ACTIVE' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Abonnés</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{subscribers.length} abonné(s)</p>
        </div>
        <Button icon={<Plus size={14} />} onClick={() => setShowAdd(true)}>Nouvel Abonné</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          <input
            type="search"
            placeholder="Rechercher par nom ou téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              title="Effacer"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
              style={{ color: 'var(--text-faint)' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text-faint)')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="relative sm:w-44">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input pr-9 appearance-none cursor-pointer w-full"
          >
            <option value="">Tous les statuts</option>
            <option value="ACTIVE">Actifs</option>
            <option value="SUSPENDED">Suspendus</option>
            <option value="EXPIRED">Expirés</option>
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nom', 'Téléphone', 'Forfait', 'Statut', 'Expiration', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i}>
                    {[1, 2, 3, 4, 5, 6].map((j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : subscribers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                    Aucun abonné trouvé
                  </td>
                </tr>
              ) : (
                subscribers.map((s: any) => (
                  <tr key={s.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{s.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{s.phone}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{s.plan?.name || '—'}</td>
                    <td className="px-4 py-3"><Badge status={s.status} /></td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(s.endDate), 'dd/MM/yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        <ActionButton onClick={() => setPaymentsFor(s)} color="var(--text-muted)" title="Paiements">
                          <Receipt size={14} />
                        </ActionButton>

                        <ActionButton onClick={() => setEditTarget(s)} color="var(--text-muted)" title="Modifier">
                          <Pencil size={14} />
                        </ActionButton>

                        {s.status === 'ACTIVE' && (
                          <ActionButton
                            onClick={() => updateStatus.mutate({ id: s.id, status: 'SUSPENDED' })}
                            color="var(--yellow-text)" title="Suspendre">
                            <Ban size={14} />
                          </ActionButton>
                        )}

                        {s.status === 'SUSPENDED' && (
                          <ActionButton
                            onClick={() => updateStatus.mutate({ id: s.id, status: 'ACTIVE' })}
                            color="#10B981" title="Réactiver">
                            <RotateCcw size={14} />
                          </ActionButton>
                        )}

                        {s.status === 'EXPIRED' && (
                          <ActionButton onClick={() => handleRestore(s)} color="#10B981" title="Restaurer l'abonnement">
                            <RotateCcw size={14} />
                          </ActionButton>
                        )}

                        {(s.status === 'ACTIVE' || s.status === 'SUSPENDED') && (
                          <ActionButton onClick={() => handleUnsubscribe(s)} color="#F97316" title="Désabonner">
                            <UserX size={14} />
                          </ActionButton>
                        )}

                        <ActionButton onClick={() => handleDelete(s)} color="#EF4444" title="Supprimer">
                          <Trash2 size={14} />
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nouvel Abonné">
        <AddSubscriberModal onClose={() => setShowAdd(false)} />
      </Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Modifier l'Abonné">
        {editTarget && <EditSubscriberModal subscriber={editTarget} onClose={() => setEditTarget(null)} />}
      </Modal>
      <Modal open={!!paymentsFor} onClose={() => setPaymentsFor(null)} title="Historique Paiements">
        {paymentsFor && <PaymentsModal subscriber={paymentsFor} onClose={() => setPaymentsFor(null)} />}
      </Modal>
    </div>
  );
}
