interface SeverityCardProps {
  severity: { critical: number; high: number; medium: number; low: number };
}

export function SeverityCard({ severity }: SeverityCardProps) {
  const total = severity.critical + severity.high + severity.medium + severity.low;
  const segs = [
    { k: 'critical', n: severity.critical, c: 'var(--danger)' },
    { k: 'high', n: severity.high, c: 'var(--warn-bright)' },
    { k: 'medium', n: severity.medium, c: 'var(--signal)' },
    { k: 'low', n: severity.low, c: 'rgba(255,255,255,.18)' },
  ];

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">
          <span className="accent-dot" />
          Severity Distribution
        </div>
        <div className="mono-label">{total} tests</div>
      </div>
      <div className="v1-sev-bar-wrap">
        {total === 0 ? (
          <div className="v1-sev-bar" style={{ width: '100%', background: 'rgba(255,255,255,.08)', color: 'var(--text-muted)' }}>
            no data
          </div>
        ) : (
          segs.map((s) =>
            s.n > 0 ? (
              <div
                key={s.k}
                className="v1-sev-bar"
                style={{ width: `${(s.n / total) * 100}%`, background: s.c }}
              >
                {s.n}
              </div>
            ) : null
          )
        )}
      </div>
      <div className="v1-sev-rows" style={{ marginTop: 14 }}>
        {segs.map((s) => (
          <div key={s.k} className="v1-sev-row">
            <span className="sw" style={{ background: s.c }} />
            <span className="label">{s.k}</span>
            <span className="num">{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
