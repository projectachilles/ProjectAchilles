import { useRef, useState } from 'react';
import { COPY, type Lang } from '../i18n';
import { genMatrix, type CellState } from '../matrix';

type Filter = 'all' | 'protected' | 'partial' | 'gap';

export function MitreMatrix({ lang }: { lang: Lang }) {
  const t = COPY[lang].mitre;
  const [filter, setFilter] = useState<Filter>('all');
  // Stable matrix per mount — useRef avoids regenerating on every render.
  const matrix = useRef(genMatrix()).current;

  const flat = matrix.flat();
  const counts: Record<CellState, number> = { empty: 0, protected: 0, partial: 0, gap: 0 };
  for (const s of flat) counts[s]++;
  const total = flat.filter((s) => s !== 'empty').length;

  const filterLabels: Record<Filter, string> = {
    all: t.filterAll,
    protected: t.filterProtected,
    partial: t.filterPartial,
    gap: t.filterGap,
  };
  const filters: Filter[] = ['all', 'protected', 'partial', 'gap'];

  return (
    <section id="mitre" className="reveal">
      <div className="lp-container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{ margin: '1.25rem 0 1rem', maxWidth: '34rem' }}>
          {t.title}
        </h2>
        <p className="section-sub">{t.sub}</p>
        <div className="mitre-wrap">
          <div className="mitre-toolbar">
            <div className="mitre-filter">
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`mitre-chip ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {filterLabels[f]}
                </button>
              ))}
            </div>
            <div className="mitre-stats">
              <div>
                <span className="mitre-stat-num green">{counts.protected}</span> {t.statProtected}
              </div>
              <div>
                <span className="mitre-stat-num amber">{counts.partial}</span> {t.statPartial}
              </div>
              <div>
                <span className="mitre-stat-num red">{counts.gap}</span> {t.statGap}
              </div>
              <div>
                <span className="mitre-stat-num">{total}</span> {t.statTests}
              </div>
            </div>
          </div>
          <div className="mitre-grid">
            {t.tactics.map((tname, c) => (
              <div key={tname} className="mitre-col">
                <div className="mitre-col-head">{tname}</div>
                {matrix[c].map((s, r) => {
                  const dim = filter !== 'all' && s !== filter && s !== 'empty';
                  return (
                    <div
                      key={r}
                      className={`mitre-cell ${s}`}
                      style={dim ? { opacity: 0.15 } : undefined}
                    >
                      <div className="mitre-tooltip">
                        T{1000 + c * 8 + r} · {s}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mitre-legend">
            <div className="mitre-legend-item">
              <span
                className="mitre-legend-sw"
                style={{ background: 'var(--accent)', opacity: 0.85 }}
              />
              {t.legendProtected}
            </div>
            <div className="mitre-legend-item">
              <span
                className="mitre-legend-sw"
                style={{ background: 'var(--warn)', opacity: 0.7 }}
              />
              {t.legendPartial}
            </div>
            <div className="mitre-legend-item">
              <span
                className="mitre-legend-sw"
                style={{ background: 'var(--danger)', opacity: 0.65 }}
              />
              {t.legendGap}
            </div>
            <div className="mitre-legend-item">
              <span
                className="mitre-legend-sw"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              />
              {t.legendUntested}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
