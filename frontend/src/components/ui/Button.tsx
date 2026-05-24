import { Loader2 } from 'lucide-react';
import { ReactNode, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: { background: 'var(--yellow)', color: '#000', border: '1px solid var(--yellow)' },
  secondary: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' },
  danger: { background: 'transparent', color: '#EF4444', border: '1px solid #EF4444' },
  ghost: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' },
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-sm',
};

export default function Button({
  variant = 'primary', size = 'md', loading, icon, children, disabled, className = '', ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-opacity ${sizes[size]} ${disabled || loading ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'} ${className}`}
      style={variantStyles[variant]}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
