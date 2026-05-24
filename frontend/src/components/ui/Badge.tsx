interface BadgeProps {
  status: string;
}

const STATUS_MAP: Record<string, { label: string; active: boolean }> = {
  ACTIVE:    { label: 'Actif',       active: true  },
  SENT:      { label: 'Envoyé',      active: true  },
  EXPIRED:   { label: 'Expiré',      active: false },
  FAILED:    { label: 'Échoué',      active: false },
  SUSPENDED: { label: 'Suspendu',    active: false },
  DRAFT:     { label: 'Brouillon',   active: false },
  PENDING:   { label: 'En attente',  active: false },
};

export default function Badge({ status }: BadgeProps) {
  const entry = STATUS_MAP[status] ?? { label: status, active: false };

  const style: React.CSSProperties = entry.active
    ? { background: 'var(--yellow-dim)', color: 'var(--yellow-text)', border: '1px solid var(--yellow)' }
    : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={style}
    >
      {entry.label}
    </span>
  );
}
