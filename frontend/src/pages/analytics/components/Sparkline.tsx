interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
  ariaLabel?: string;
}

export default function Sparkline({
  data,
  width = 100,
  height = 28,
  strokeWidth = 1.5,
  className,
  ariaLabel,
}: SparklineProps) {
  if (data.length < 2) {
    return null;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const coords = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });

  const points = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const fillPath = `M 0,${height} L ${coords
    .map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' L ')} L ${width},${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      preserveAspectRatio="none"
    >
      <path d={fillPath} fill="currentColor" fillOpacity="0.12" stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
