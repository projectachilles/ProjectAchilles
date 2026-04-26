import { COPY, type Lang } from '../i18n';
import { I } from '../icons';

export function Problem({ lang }: { lang: Lang }) {
  const t = COPY[lang].problem;
  const icons = [I.Clock, I.Alert, I.Bar, I.Off];
  return (
    <section id="problem" className="reveal">
      <div className="lp-container">
        <div className="problem-grid">
          <div>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2 className="section-title" style={{ margin: '1.25rem 0 1rem' }}>
              {t.title}
            </h2>
            <p className="section-sub">{t.sub}</p>
          </div>
          <div className="problem-cards">
            {t.items.map((it, i) => (
              <div key={i} className="problem-card reveal">
                <div className="problem-icon">{icons[i]}</div>
                <div className="problem-title">{it.t}</div>
                <div className="problem-desc">{it.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
