import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  change?: string;
  loading?: boolean;
}

export default function StatCard({ title, value, icon: Icon, change, loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="card p-3.5">
        <div className="skeleton h-3 w-20 mb-2.5" />
        <div className="skeleton h-6 w-14" />
      </div>
    );
  }

  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>{title}</p>
        <Icon size={14} style={{ color: 'var(--yellow)' }} />
      </div>
      <p className="text-xl font-bold leading-tight" style={{ color: 'var(--text)' }}>{value}</p>
      {change && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>{change}</p>
      )}
    </div>
  );
}
