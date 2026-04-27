interface SunburstSub {
  name: string;
  score: number;
}

interface SunburstCategory {
  id: string;
  name: string;
  score: number;
  color: string;
  subs: SunburstSub[];
}

interface SunburstProps {
  data: SunburstCategory[];
  size?: number;
}

/**
 * Two-ring sunburst — outer ring shows subcategories, inner ring shows
 * the parent category. Implementation matches the prototype `Sunburst`
 * component exactly so the dashboard composition stays pixel-faithful.
 */
export function Sunburst({ data, size = 160 }: SunburstProps) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInnerMid = rOuter - 18;
  const rCore = rInnerMid - 18;
  const total = data.reduce((s, c) => s + c.subs.length, 0);

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="rgba(255,255,255,.04)" />
      </svg>
    );
  }

  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* outer ring: subcategories */}
      {data.flatMap((c, ci) => c.subs.map((s, si) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
        acc += 1;
        const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + rOuter * Math.cos(start);
        const y1 = cy + rOuter * Math.sin(start);
        const x2 = cx + rOuter * Math.cos(end);
        const y2 = cy + rOuter * Math.sin(end);
        const x3 = cx + rInnerMid * Math.cos(end);
        const y3 = cy + rInnerMid * Math.sin(end);
        const x4 = cx + rInnerMid * Math.cos(start);
        const y4 = cy + rInnerMid * Math.sin(start);
        const large = end - start > Math.PI ? 1 : 0;
        return (
          <path
            key={`${ci}-${si}-${s.name}`}
            d={`M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInnerMid} ${rInnerMid} 0 ${large} 0 ${x4} ${y4} Z`}
            fill={c.color}
            opacity={0.45 + si * 0.18}
            stroke="#0a0e1a"
            strokeWidth={1}
          />
        );
      }))}
      {/* inner ring: categories */}
      {(() => {
        let cAcc = 0;
        return data.map((c, i) => {
          const cStart = (cAcc / total) * Math.PI * 2 - Math.PI / 2;
          cAcc += c.subs.length;
          const cEnd = (cAcc / total) * Math.PI * 2 - Math.PI / 2;
          const x1 = cx + rInnerMid * Math.cos(cStart);
          const y1 = cy + rInnerMid * Math.sin(cStart);
          const x2 = cx + rInnerMid * Math.cos(cEnd);
          const y2 = cy + rInnerMid * Math.sin(cEnd);
          const x3 = cx + rCore * Math.cos(cEnd);
          const y3 = cy + rCore * Math.sin(cEnd);
          const x4 = cx + rCore * Math.cos(cStart);
          const y4 = cy + rCore * Math.sin(cStart);
          const large = cEnd - cStart > Math.PI ? 1 : 0;
          return (
            <path
              key={`${c.id}-${i}`}
              d={`M ${x1} ${y1} A ${rInnerMid} ${rInnerMid} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rCore} ${rCore} 0 ${large} 0 ${x4} ${y4} Z`}
              fill={c.color}
              stroke="#0a0e1a"
              strokeWidth={1.5}
            />
          );
        });
      })()}
      <circle cx={cx} cy={cy} r={rCore} fill="#0a0e1a" stroke="rgba(255,255,255,.06)" />
    </svg>
  );
}

export type { SunburstCategory, SunburstSub };
