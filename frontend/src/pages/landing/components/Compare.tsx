import type { ReactNode } from 'react';
import { COPY, type Lang } from '../i18n';
import { I } from '../icons';

function renderCell(v: string): ReactNode {
  if (v === 'yes') return <span className="compare-mark yes">{I.Check}</span>;
  if (v === 'no') return <span className="compare-mark no">—</span>;
  if (v === 'partial') return <span className="compare-mark partial">◐</span>;
  return v;
}

export function Compare({ lang }: { lang: Lang }) {
  const t = COPY[lang].compare;
  return (
    <section id="compare" className="reveal">
      <div className="lp-container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{ margin: '1.25rem 0 1rem', maxWidth: '36rem' }}>
          {t.title}
        </h2>
        <p className="section-sub">{t.sub}</p>
        <div className="compare-table">
          <div className="compare-row head">
            <div className="compare-cell">{t.colCap}</div>
            <div className="compare-cell us">{t.colUs}</div>
            <div className="compare-cell">AttackIQ</div>
            <div className="compare-cell">SafeBreach</div>
            <div className="compare-cell">Picus</div>
          </div>
          {t.rows.map((row, i) => (
            <div key={i} className="compare-row">
              <div className="compare-cell label">{row[0]}</div>
              <div className="compare-cell us">{renderCell(String(row[1]))}</div>
              <div className="compare-cell">{renderCell(String(row[2]))}</div>
              <div className="compare-cell">{renderCell(String(row[3]))}</div>
              <div className="compare-cell">{renderCell(String(row[4]))}</div>
            </div>
          ))}
        </div>
        <p
          style={{
            marginTop: '1rem',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          {t.footnote}
        </p>
      </div>
    </section>
  );
}
