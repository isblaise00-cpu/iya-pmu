interface ConfidenceGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function ConfidenceGauge({ score, size = 'md' }: ConfidenceGaugeProps) {
  const heightMap = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const textMap = { sm: 'text-xs', md: 'text-sm', lg: 'text-sm' };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className={`${textMap[size]} font-medium`} style={{ color: 'var(--text-muted)' }}>
          Confiance
        </span>
        <span className={`${textMap[size]} font-bold`} style={{ color: 'var(--yellow-text)' }}>
          {score}/100
        </span>
      </div>
      <div className={`w-full ${heightMap[size]} rounded-full`} style={{ background: 'var(--border)' }}>
        <div
          className={`${heightMap[size]} rounded-full transition-all duration-700`}
          style={{ width: `${score}%`, background: 'var(--yellow)' }}
        />
      </div>
    </div>
  );
}
