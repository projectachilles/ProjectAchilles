import { COPY, type Lang } from '../i18n';
import { delay } from '../anim';

export function Manifesto({ lang }: { lang: Lang }) {
  const t = COPY[lang].manifesto;
  return (
    <section className="lp-section">
      <div className="lp-container lp-manifesto">
        <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
        <div className="lp-manifesto-body">
          <p className="lp-statement" data-reveal>{t.statement}</p>
          <div className="lp-beliefs">
            {t.items.map((it, i) => (
              <div key={i} className="lp-belief" data-reveal style={delay(0.1 * (i + 1))}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="t">{it.t}</span>
                <span className="d">{it.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
