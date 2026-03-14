interface TechniqueBadgeProps {
  technique: string;
  size?: 'xs' | 'sm' | 'md';
}

export default function TechniqueBadge({ technique, size = 'md' }: TechniqueBadgeProps) {
  const sizeClasses = {
    xs: 'px-1 py-0.5 text-[9px]',
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
  }[size];

  return (
    <span className={`inline-flex items-center rounded-md bg-primary/10 text-primary font-mono font-medium ${sizeClasses}`}>
      {technique}
    </span>
  );
}
