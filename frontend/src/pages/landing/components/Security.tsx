import { COPY, type Lang } from '../i18n';
import { I } from '../icons';

export function Security({ lang }: { lang: Lang }) {
  const t = COPY[lang].security;
  const icons = [I.Lock, I.Shield, I.Clock, I.Zap, I.Network, I.Bar];
  return (
    <section className="reveal">
      <div className="lp-container">
        <div className="security-block">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2
              className="section-title"
              style={{ margin: '1.25rem 0 0.5rem', fontSize: '2rem' }}
            >
              {t.title}
            </h2>
            <p className="section-sub" style={{ margin: '0 auto' }}>
              {t.sub}
            </p>
          </div>
          <div className="security-grid">
            {t.items.map((label, i) => (
              <div key={i} className="security-item">
                {icons[i]}
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
