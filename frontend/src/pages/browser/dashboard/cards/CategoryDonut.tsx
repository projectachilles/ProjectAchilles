interface Category { id: string; name: string; count: number; color: string }
interface CategoryDonutProps { categories: Category[] }

export function CategoryDonut({ categories }: CategoryDonutProps) {
  const total = categories.reduce((s, c) => s + c.count, 0);
  const r = 38;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">
          <span className="accent-dot" />
          Category Breakdown
        </div>
        <div className="mono-label">{categories.length} cats</div>
      </div>
      <div className="v1-donut-wrap">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="14" />
          {total > 0 &&
            categories.map((cat) => {
              const len = (cat.count / total) * c;
              const dash = `${len} ${c - len}`;
              const el = (
                <circle
                  key={cat.id}
                  cx="55"
                  cy="55"
                  r={r}
                  fill="none"
                  stroke={cat.color}
                  strokeWidth="14"
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 55 55)"
                  style={{ transition: 'all .8s' }}
                />
              );
              offset += len;
              return el;
            })}
          <text
            x="55"
            y="60"
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontWeight="700"
            fontSize="20"
            fill="var(--text-primary)"
          >
            {total}
          </text>
        </svg>
        <div className="v1-donut-legend">
          {categories.length === 0 ? (
            <div className="v1-empty" style={{ padding: '8px 0' }}>no categories</div>
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className="v1-donut-row">
                <div className="lhs">
                  <span className="sw" style={{ background: cat.color }} />
                  <span className="name" title={cat.name}>{cat.name}</span>
                </div>
                <span className="val">{cat.count}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
