import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Trophy, Users, CreditCard,
  MessageSquare, BarChart2, Settings, Zap, Sun, Moon, LogOut, ShieldCheck, Shield, Eye
} from 'lucide-react';
import { useAuth, UserRole } from '../../contexts/AuthContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/pronostics', icon: Trophy, label: 'Pronostics' },
  { to: '/subscribers', icon: Users, label: 'Abonnés' },
  { to: '/plans', icon: CreditCard, label: 'Forfaits' },
  { to: '/sms', icon: MessageSquare, label: 'SMS' },
  { to: '/results', icon: BarChart2, label: 'Résultats' },
  { to: '/settings', icon: Settings, label: 'Paramètres' },
];

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  SUPER_ADMIN: <ShieldCheck size={11} />,
  ADMIN: <Shield size={11} />,
  VIEWER: <Eye size={11} />,
};

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  VIEWER: 'Lecteur',
};

interface SidebarProps {
  dark: boolean;
  onToggleTheme: () => void;
}

export default function Sidebar({ dark, onToggleTheme }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const allNavItems = user?.role === 'SUPER_ADMIN'
    ? [...navItems, { to: '/users', icon: ShieldCheck, label: 'Utilisateurs' }]
    : navItems;

  return (
    <aside
      className="fixed left-0 top-0 h-full w-[240px] flex flex-col z-40"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Logo */}
      <div
        className="flex items-center justify-between px-5 py-5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--yellow)' }}
          >
            <Zap size={16} color="#000" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-none" style={{ color: 'var(--text)' }}>IYA-PMU</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--yellow-text)' }}>Pronostics</p>
          </div>
        </div>
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title={dark ? 'Mode clair' : 'Mode sombre'}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {allNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {({ isActive }) => (
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                style={{
                  background: isActive ? 'var(--yellow-dim)' : 'transparent',
                  color: isActive ? 'var(--yellow-text)' : 'var(--text-muted)',
                }}
                onMouseEnter={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <Icon size={16} />
                <span className="text-sm font-medium">{label}</span>
                {isActive && (
                  <div className="ml-auto w-1 h-4 rounded-full" style={{ background: 'var(--yellow)' }} />
                )}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{user.name}</p>
              <span
                className="inline-flex items-center gap-1 text-xs mt-0.5"
                style={{ color: 'var(--yellow-text)' }}
              >
                {ROLE_ICONS[user.role]} {ROLE_LABELS[user.role]}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg ml-2 flex-shrink-0"
              style={{ color: 'var(--text-faint)' }}
              title="Se déconnecter"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
