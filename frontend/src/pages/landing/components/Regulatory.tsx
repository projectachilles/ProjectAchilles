import { useState } from 'react';
import { COPY, FRAMEWORKS, type Framework, type Lang } from '../i18n';

export function Regulatory({ lang }: { lang: Lang }) {
  const t = COPY[lang].reg;
  const frameworks = FRAMEWORKS[lang];
  const [activeId, setActiveId] = useState<Framework['id']>('dora');
  const fw = frameworks.find((f) => f.id === activeId) ?? frameworks[0];
  const cells = Array.from({ length: 80 }, (_, i) => i < (fw.coverage * 80) / 100);

  return (
    <section id="regulatory" className="reg-section reveal">
      <div className="lp-container">
        <div style={{ textAlign: 'center', maxWidth: '46rem', margin: '0 auto' }}>
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 className="section-title" style={{ margin: '1.25rem 0 1rem' }}>
            {t.title}
          </h2>
          <p className="section-sub" style={{ margin: '0 auto' }}>
            {t.sub}
          </p>
        </div>
        <div className="reg-frameworks reveal">
          {frameworks.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`reg-fw ${activeId === f.id ? 'active' : ''}`}
              onClick={() => setActiveId(f.id)}
            >
              <div className="reg-fw-name">{f.name}</div>
              <div className="reg-fw-tag">{f.tag}</div>
              <div className="reg-fw-stat">{f.stat}</div>
            </button>
          ))}
        </div>
        <div className="reg-detail reveal">
          <div>
            <div className="reg-detail-title">{fw.title}</div>
            <p className="reg-detail-desc">{fw.desc}</p>
            <ul className="reg-controls">
              {fw.controls.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="reg-coverage">
            <div className="reg-coverage-label">{t.coverage}</div>
            <div className="reg-coverage-value">{fw.coverage}%</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              {t.coverageNote.replace('{fw}', fw.name)}
            </div>
            <div className="reg-coverage-cells">
              {cells.map((on, i) => (
                <div key={i} className={`reg-coverage-cell ${on ? 'on' : ''}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
