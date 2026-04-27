interface DonutSlice {
  pct: number;
  color: string;
}

interface DonutProps {
  slices: DonutSlice[];
  size?: number;
  label: string;
  sublabel?: string;
}

/**
 * Multi-segment donut with center label.
 */
export function Donut({ slices, size = 120, label, sublabel }: DonutProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.04)" strokeWidth={10} />
        {slices.map((s, i) => {
          const len = (s.pct / 100) * c;
          const dash = `${len} ${c - len}`;
          const node = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={10}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return node;
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            {label}
          </div>
          {sublabel && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '.18em',
                marginTop: 2,
              }}
            >
              {sublabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
