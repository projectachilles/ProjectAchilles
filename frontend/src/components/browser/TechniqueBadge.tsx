interface TechniqueBadgeProps {
  technique: string;
  size?: 'sm' | 'md';
}

export default function TechniqueBadge({ technique, size = 'md' }: TechniqueBadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-1 text-xs';

  return (
    <span className={`inline-flex items-center rounded-md bg-primary/10 text-primary font-mono font-medium ${sizeClasses}`}>
      {technique}
    </span>
  );
}
