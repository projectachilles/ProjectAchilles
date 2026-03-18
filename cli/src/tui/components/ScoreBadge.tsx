/**
 * Defense score badge with color-coded value and progress bar.
 */

interface ScoreBadgeProps {
  score: number;
  label?: string;
  width?: number;
}

export function ScoreBadge({ score, label = 'Defense Score', width = 30 }: ScoreBadgeProps) {
  const pct = Math.round(score);
  const barWidth = width - 10;
  const filled = Math.round((score / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  let color: string;
  if (score >= 80) color = '#16c79a';
  else if (score >= 60) color = '#f5c518';
  else if (score >= 40) color = '#ff9f43';
  else color = '#e94560';

  return (
    <box flexDirection="row" height={1}>
      <text fg="#6c6c8a">{label}: </text>
      <text fg={color}>{pct}% </text>
      <text fg={color}>{bar}</text>
    </box>
  );
}
