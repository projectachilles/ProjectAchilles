import { useState, useMemo } from 'react';

interface Tactic { id: string; name: string; techniques: number; covered: number }
interface MitreMatrixProps { tactics: Tactic[] }

type Filter = 'all' | 'covered' | 'gaps';

function deterministicCells(t: Tactic): Array<'covered' | 'partial' | 'gap'> {
  const arr: Array<'covered' | 'partial' | 'gap'> = [];
  for (let i = 0; i < t.techniques; i++) {
    const seed = (t.id.charCodeAt(0) + i * 7) % 100;
    let kind: 'covered' | 'partial' | 'gap' = 'gap';
    if (i < t.covered) kind = 'covered';
    else if (seed > 70) kind = 'partial';
    arr.push(kind);
  }
  return arr;
}

export function MitreMatrix({ tactics }: MitreMatrixProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const stats = useMemo(() => {
    const totalTechniques = tactics.reduce((s, t) => s + t.techniques, 0);
    const covered = tactics.filter((t) => t.covered > 0).length;
    return { totalTechniques, covered };
  }, [tactics]);

  const visible = (kind: 'covered' | 'partial' | 'gap'): boolean => {
    if (filter === 'all') return true;
    if (filter === 'covered') return kind === 'covered';
    return kind === 'gap' || kind === 'partial';
  };

  return (
    <div className="v1-mitre">
      <div className="v1-mitre-head">
        <div className="v1-mitre-title-row">
          <div className="v1-mitre-title">MITRE ATT&amp;CK · COVERAGE</div>
          <div className="v1-mitre-stats">
            <div className="v1-mitre-stat"><strong>{stats.totalTechniques}</strong> techniques</div>
            <div className="v1-mitre-stat"><strong>{stats.covered} / {tactics.length}</strong> tactics</div>
          </div>
        </div>
        <div className="v1-mitre-chips">
          {(['all', 'covered', 'gaps'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`v1-chip ${filter === k ? 'active' : ''}`}
              onClick={() => setFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="v1-matrix v1-mitre-matrix">
        {tactics.map((t) => {
          const pct = t.techniques > 0 ? Math.round((t.covered / t.techniques) * 100) : 0;
          return (
            <div key={t.id} className="v1-matrix-col">
              <div className="v1-matrix-head" title={t.name}>
                {t.id}
                <span className="pct">{pct}%</span>
              </div>
              <div className="cells">
                {deterministicCells(t).map((k, i) => (
                  <div
                    key={i}
                    className={`v1-matrix-cell ${k}`}
                    style={{ opacity: visible(k) ? undefined : 0.15 }}
                    title={`${t.name} — ${k}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="v1-mitre-legend">
        <div className="v1-mitre-legend-item">
          <span className="v1-mitre-legend-sw" style={{ background: 'var(--accent)', opacity: 0.9 }} /> covered
        </div>
        <div className="v1-mitre-legend-item">
          <span className="v1-mitre-legend-sw" style={{ background: 'var(--accent)', opacity: 0.35 }} /> partial
        </div>
        <div className="v1-mitre-legend-item">
          <span className="v1-mitre-legend-sw" style={{ background: 'rgba(255,59,92,.2)' }} /> gap
        </div>
      </div>
    </div>
  );
}
