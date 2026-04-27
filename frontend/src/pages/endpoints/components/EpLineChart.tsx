interface Series {
  data: number[];
  color: string;
  opacity?: number;
}

interface EpLineChartProps {
  series: Series[];
  height?: number;
  showAxes?: boolean;
  yMax?: number;
}

/**
 * Full-width SVG line chart with axis ticks and multi-series support.
 * Locked to line-only style per Q6 (area variant stripped from prototype).
 */
export function EpLineChart({ series, height = 200, showAxes = true, yMax }: EpLineChartProps) {
  const w = 720;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const cw = w - padL - padR;
  const ch = height - padT - padB;
  const allMax = yMax ?? Math.max(1, ...series.flatMap((s) => s.data));
  const yScale = (v: number) => padT + ch - (v / allMax) * ch;
  const xScale = (i: number, n: number) => padL + (i / Math.max(1, n - 1)) * cw;
  const linePath = (data: number[]) =>
    data
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i, data.length)},${yScale(v)}`)
      .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      {showAxes &&
        [0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={padT + ch * (1 - t)}
              x2={padL + cw}
              y2={padT + ch * (1 - t)}
              stroke="rgba(255,255,255,.04)"
              strokeDasharray="2 4"
            />
            <text
              x={padL - 6}
              y={padT + ch * (1 - t) + 3}
              fill="#6b7388"
              fontSize="9"
              textAnchor="end"
              fontFamily="var(--font-mono)"
              stroke="none"
            >
              {Math.round(allMax * t)}
            </text>
          </g>
        ))}
      {series.map((s, i) =>
        s.data.length >= 2 ? (
          <path
            key={i}
            d={linePath(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.4}
            opacity={s.opacity ?? 1}
          />
        ) : null,
      )}
    </svg>
  );
}
