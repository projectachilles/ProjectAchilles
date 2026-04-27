interface DonutSlice {
  /** Display name. */
  name: string;
  /** Slice weight (any positive scalar — relative ratios matter). */
  pct: number;
  /** SVG colour for the slice. */
  color: string;
}

interface DonutProps {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  label?: string | number;
  sublabel?: string;
}

/**
 * Compact ring donut — used for error-type breakdown and category totals.
 * Implementation matches the prototype `Donut` component exactly.
 */
export function Donut({ data, size = 140, thickness = 22, label, sublabel }: DonutProps) {
  const total = data.reduce((s, x) => s + x.pct, 0);
  const r = size / 2 - thickness / 2;
  const cx = size / 2;
  const cy = size / 2;

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.04)" strokeWidth={thickness} />
        {label != null && (
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            fontSize="20"
            fontWeight={700}
            fill="var(--text-primary)"
            fontFamily="var(--font-display)"
            stroke="none"
          >
            {label}
          </text>
        )}
      </svg>
    );
  }

  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const end = ((acc + d.pct) / total) * Math.PI * 2 - Math.PI / 2;
        acc += d.pct;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const large = end - start > Math.PI ? 1 : 0;
        return (
          <path
            key={`${d.name}-${i}`}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill="none"
            stroke={d.color}
            strokeWidth={thickness}
          />
        );
      })}
      {label != null && (
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize="20"
          fontWeight={700}
          fill="var(--text-primary)"
          fontFamily="var(--font-display)"
          stroke="none"
        >
          {label}
        </text>
      )}
      {sublabel && (
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="9"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing=".15em"
          stroke="none"
        >
          {sublabel}
        </text>
      )}
    </svg>
  );
}
