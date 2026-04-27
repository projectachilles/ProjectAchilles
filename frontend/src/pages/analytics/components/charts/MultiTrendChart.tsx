/**
 * MultiTrendChart — multi-series trend chart matching the prototype's
 * `TrendChart`. Pure SVG so it inherits the Tactical Green tokens.
 *
 * Series keys correspond to the dashboard's three lines:
 *   defense (signal blue), secure (accent green), error (danger, dashed).
 */
interface SeriesPoint {
  label: string;
  defense?: number | null;
  secure?: number | null;
  error?: number | null;
}

interface MultiTrendChartProps {
  data: SeriesPoint[];
  width?: number;
  height?: number;
  padding?: number;
}

export function MultiTrendChart({
  data,
  width = 820,
  height = 260,
  padding = 36,
}: MultiTrendChartProps) {
  if (!data.length) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="an-trend-svg" preserveAspectRatio="none" aria-hidden="true">
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="11"
          fontFamily="var(--font-mono)"
          letterSpacing=".15em"
        >
          NO DATA
        </text>
      </svg>
    );
  }

  const w = width - padding * 2;
  const h = height - padding - 16;
  const xStep = data.length > 1 ? w / (data.length - 1) : 0;
  const yScale = (v: number) => h - (v / 100) * h + 12;
  // Error rate uses a separate scale (0..maxError, defaulting to 8 like prototype).
  const maxError = Math.max(8, ...data.map(d => (d.error ?? 0)));
  const errYScale = (v: number) => h - (v / maxError) * h + 12;

  const linePath = (
    vals: Array<number | null | undefined>,
    scale: (v: number) => number,
  ) => {
    const segments: string[] = [];
    let started = false;
    vals.forEach((v, i) => {
      if (v == null || Number.isNaN(v)) {
        started = false;
        return;
      }
      const x = padding + i * xStep;
      const y = scale(v);
      segments.push(`${started ? 'L' : 'M'}${x},${y}`);
      started = true;
    });
    return segments.join(' ');
  };

  const areaPath = (vals: Array<number | null | undefined>, scale: (v: number) => number) => {
    const valid = vals.map((v, i) => ({ v, i })).filter(p => p.v != null && !Number.isNaN(p.v));
    if (!valid.length) return '';
    const path = linePath(vals, scale);
    if (!path) return '';
    const lastX = padding + valid[valid.length - 1].i * xStep;
    const firstX = padding + valid[0].i * xStep;
    return `${path} L${lastX},${scale(0)} L${firstX},${scale(0)} Z`;
  };

  const defenseVals = data.map(d => d.defense);
  const secureVals = data.map(d => d.secure);
  const errorVals = data.map(d => d.error);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="an-trend-svg" preserveAspectRatio="none">
      {/* gridlines */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line
            x1={padding}
            y1={yScale(v)}
            x2={padding + w}
            y2={yScale(v)}
            stroke="rgba(255,255,255,.04)"
            strokeDasharray="2 4"
          />
          <text
            x={padding - 8}
            y={yScale(v) + 4}
            fill="#6b7388"
            fontSize="9.5"
            textAnchor="end"
            fontFamily="var(--font-mono)"
            stroke="none"
          >
            {v}%
          </text>
        </g>
      ))}
      {/* x labels (every ~4 days) */}
      {data.map((d, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0 && (
        <text
          key={`${d.label}-${i}`}
          x={padding + i * xStep}
          y={height - 2}
          fill="#6b7388"
          fontSize="9.5"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          stroke="none"
        >
          {d.label}
        </text>
      ))}
      {/* secure (accent area + line) */}
      <path d={areaPath(secureVals, yScale)} fill="rgba(0,230,138,.10)" />
      <path d={linePath(secureVals, yScale)} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {/* defense (signal area + line) */}
      <path d={areaPath(defenseVals, yScale)} fill="rgba(79,142,255,.12)" />
      <path d={linePath(defenseVals, yScale)} fill="none" stroke="var(--signal)" strokeWidth="2" />
      {/* error (right axis, dashed) */}
      <path d={linePath(errorVals, errYScale)} fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}
