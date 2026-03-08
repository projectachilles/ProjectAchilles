import { targetShortLabel, targetColor } from '@/utils/platformLabels';

interface TargetBadgeProps {
  target: string;
}

export default function TargetBadge({ target }: TargetBadgeProps) {
  const color = targetColor(target);
  const label = targetShortLabel(target);

  return (
    <span className={`inline-flex items-center gap-1 ${color}`} title={target}>
      <svg className="w-2 h-2" viewBox="0 0 8 8" fill="currentColor">
        <circle cx="4" cy="4" r="4" />
      </svg>
      <span className="text-[10px] font-medium">{label}</span>
    </span>
  );
}
