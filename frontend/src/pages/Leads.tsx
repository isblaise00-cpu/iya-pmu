import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Search, Trash2, X } from 'lucide-react';
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
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
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

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Leads</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{total} numéro(s) non abonné(s)</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          <input
            type="search"
            placeholder="Rechercher par numéro..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded"
              style={{ color: 'var(--text-faint)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="input"
            title="Date début"
          />
        </div>
        <div>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="input"
            title="Date fin"
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button variant="secondary" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Tableau */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Numéro', 'Dernière commande', 'Requêtes', 'Premier contact', 'Dernier contact', 'Actions'].map((h) => (
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
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                    Aucun lead trouvé
                  </td>
                </tr>
              ) : (
                leads.map((lead: any) => (
                  <tr
                    key={lead.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{lead.phone}</td>
                    <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--text-muted)' }}>{lead.lastCommand}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{lead.requestCount}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(lead.firstSeenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(lead.lastSeenAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { if (confirm(`Supprimer le lead ${lead.phone} ?`)) deleteMutation.mutate(lead.id); }}
                        className="p-1.5 rounded transition-colors"
                        style={{ color: 'var(--text-faint)' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#EF4444')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text-faint)')}
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Page {page} / {totalPages}
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
