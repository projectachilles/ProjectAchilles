import { COPY, type Lang } from '../i18n';
import { I } from '../icons';

export function Features({ lang }: { lang: Lang }) {
  const t = COPY[lang].features;
  const icons = [I.Sparkle, I.Server, I.Bar, I.Terminal, I.Shield, I.Layers];
  return (
    <section id="features" className="reveal">
      <div className="lp-container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{ margin: '1.25rem 0 1rem', maxWidth: '30rem' }}>
          {t.title}
        </h2>
        <p className="section-sub">{t.sub}</p>
        <div className="feature-grid">
          {t.items.map((it, i) => (
            <div key={i} className="feature-card reveal">
              <div className="feature-icon">{icons[i]}</div>
              <div className="feature-title">{it.t}</div>
              <div className="feature-desc">{it.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
