import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useTheme } from '../../hooks/useTheme';

export default function Layout() {
  const { dark, toggle } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar dark={dark} onToggleTheme={toggle} />
      <main className="flex-1 ml-[240px] overflow-y-auto">
        <div className="min-h-full p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
