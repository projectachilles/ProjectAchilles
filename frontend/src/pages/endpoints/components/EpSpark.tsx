interface EpSparkProps {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
}

/**
 * Tiny SVG sparkline for KPI cards / heartbeat tiles.
 */
export function EpSpark({ data, color = '#00e68a', w = 100, h = 28 }: EpSparkProps) {
  if (!data || data.length < 2) {
    return <svg width={w} height={h} style={{ display: 'block' }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i): [number, number] => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / range) * (h - 4) - 2,
  ]);
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}
