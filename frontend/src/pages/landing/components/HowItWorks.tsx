import { useState } from 'react';
import { COPY, STEP_BODIES, type Lang } from '../i18n';

export function HowItWorks({ lang }: { lang: Lang }) {
  const t = COPY[lang].how;
  const [active, setActive] = useState(0);
  const bodies = STEP_BODIES[lang];

  return (
    <section id="how" className="reveal">
      <div className="lp-container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{ margin: '1.25rem 0 1rem', maxWidth: '34rem' }}>
          {t.title}
        </h2>
        <p className="section-sub">{t.sub}</p>
        <div className="pipeline">
          {t.steps.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`pipeline-step ${active === i ? 'active' : ''}`}
              onClick={() => setActive(i)}
            >
              <div className="pipeline-num">
                {t.stage} 0{i + 1}
              </div>
              <div className="pipeline-title">{s.title}</div>
              <div className="pipeline-desc">{s.desc}</div>
              <div className="pipeline-arrow">→</div>
            </button>
          ))}
        </div>
        <div className="pipeline-detail">
          {bodies[active].map((l, i) => (
            <span key={`${active}-${i}`} className={`viz-line viz-${l.t}`}>
              {l.x}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
