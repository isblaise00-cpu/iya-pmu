import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Search, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';
import Button from '../components/ui/Button';

const API = import.meta.env.VITE_API_URL ?? '/api';

async function fetchLeads(params: { page: number; search: string; dateFrom: string; dateTo: string }) {
  const q = new URLSearchParams();
  q.set('page', String(params.page));
  q.set('limit', '20');
  if (params.search)   q.set('search',   params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo)   q.set('dateTo',   params.dateTo);
  const { data } = await axios.get(`${API}/leads?${q}`, { withCredentials: true });
  return data;
}

async function deleteLead(id: number) {
  await axios.delete(`${API}/leads/${id}`, { withCredentials: true });
}

export default function Leads() {
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', page, search, dateFrom, dateTo],
    queryFn: () => fetchLeads({ page, search, dateFrom, dateTo }),
  });

  const leads      = data?.leads ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const deleteMutation = useMutation({
    mutationFn: deleteLead,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Lead supprimé'); },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Leads</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Numéros ayant interagi sans être abonnés
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: 'var(--bg-card)' }}>
          <Users size={18} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{total}</span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>lead{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Filtres */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end p-4 rounded-xl" style={{ background: 'var(--bg-card)' }}>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Recherche numéro</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="+226..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="input pl-8"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Date début</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Date fin</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="input" />
        </div>
        {(search || dateFrom || dateTo) && (
          <Button variant="secondary" type="button" onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setPage(1); }}>
            Réinitialiser
          </Button>
        )}
      </form>

      {/* Tableau */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Chargement...</div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucun lead trouvé</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Numéro', 'Dernière commande', 'Requêtes', 'Premier contact', 'Dernier contact', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <tr key={lead.id} style={{ borderBottom: '1px solid var(--border)' }} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{lead.phone}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-hover)', color: 'var(--accent)' }}>
                      {lead.lastCommand}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{lead.requestCount}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(lead.firstSeenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(lead.lastSeenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { if (confirm(`Supprimer le lead ${lead.phone} ?`)) deleteMutation.mutate(lead.id); }}
                      className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 size={14} style={{ color: 'var(--text-muted)' }} className="hover:text-red-400" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Page {page} / {totalPages} — {total} lead{total !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Précédent</Button>
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Suivant</Button>
          </div>
        </div>
      )}
    </div>
  );
}
