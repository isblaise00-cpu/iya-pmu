import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth, UserRole } from '../contexts/AuthContext';
import { UserPlus, Trash2, Edit2, ShieldCheck, Shield, Eye, Lock, Unlock } from 'lucide-react';

interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  VIEWER: 'Lecteur',
};

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  SUPER_ADMIN: <ShieldCheck size={13} />,
  ADMIN: <Shield size={13} />,
  VIEWER: <Eye size={13} />,
};

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: '#F59E0B',
  ADMIN: '#3b82f6',
  VIEWER: '#6b7280',
};

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'ADMIN' as UserRole });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/users').then((r) => setUsers(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm({ email: '', name: '', password: '', role: 'ADMIN' });
    setError('');
    setShowForm(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({ email: u.email, name: u.name, password: '', role: u.role });
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      if (editUser) {
        const data: any = { name: form.name, role: form.role };
        if (form.password) data.password = form.password;
        await api.put(`/users/${editUser.id}`, data);
      } else {
        await api.post('/users', form);
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Supprimer ${u.name} ?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleActive = async (u: User) => {
    if (u.id === me?.userId) return;
    const blocking = u.isActive;
    const msg = blocking
      ? `Bloquer ${u.name} ?\n\nIl ne pourra plus se connecter à la plateforme jusqu'à ce que vous le débloquiez.`
      : `Débloquer ${u.name} ?\n\nIl pourra à nouveau se connecter à la plateforme.`;
    if (!confirm(msg)) return;
    try {
      await api.put(`/users/${u.id}`, { isActive: !u.isActive });
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Gestion des utilisateurs</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Comptes admin de la plateforme</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: 'var(--yellow)', color: '#000' }}
        >
          <UserPlus size={15} /> Nouvel utilisateur
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nom', 'Email', 'Rôle', 'Statut', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text)' }}>
                    {u.name}
                    {u.id === me?.userId && <span className="ml-2 text-xs" style={{ color: 'var(--text-faint)' }}>(vous)</span>}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: ROLE_COLORS[u.role] + '22', color: ROLE_COLORS[u.role] }}
                    >
                      {ROLE_ICONS[u.role]} {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        background: u.isActive ? '#16a34a22' : '#dc262622',
                        color: u.isActive ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {u.isActive ? 'Actif' : 'Bloqué'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                        title="Modifier"
                      >
                        <Edit2 size={14} />
                      </button>
                      {u.id !== me?.userId && (
                        <button
                          onClick={() => handleToggleActive(u)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: u.isActive ? '#F97316' : '#10B981' }}
                          title={u.isActive ? 'Bloquer' : 'Débloquer'}
                        >
                          {u.isActive ? <Lock size={14} /> : <Unlock size={14} />}
                        </button>
                      )}
                      {u.id !== me?.userId && (
                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: '#dc2626' }}
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card w-full max-w-md p-6 space-y-4">
            <h2 className="font-bold text-base" style={{ color: 'var(--text)' }}>
              {editUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
            </h2>

            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: '#fee2e2', color: '#dc2626' }}>
                {error}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Nom</label>
              <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            {!editUser && (
              <div className="space-y-1">
                <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Email</label>
                <input type="email" className="input w-full" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Mot de passe {editUser && <span style={{ color: 'var(--text-faint)' }}>(laisser vide pour ne pas modifier)</span>}
              </label>
              <input type="password" className="input w-full" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>

            <div className="space-y-1">
              <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Rôle</label>
              <select
                className="input w-full"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="ADMIN">Admin</option>
                <option value="VIEWER">Lecteur</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--bg-hover)', color: 'var(--text)' }}
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--yellow)', color: '#000', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
