import { COPY, type Lang } from '../i18n';
import { delay } from '../anim';

export function LocalAI({ lang }: { lang: Lang }) {
  const t = COPY[lang].local;
  const [c1, c2, c3, c4] = t.cells;
  return (
    <section id="local" className="lp-section">
      <div className="lp-container lp-local">
        <div className="lp-local-copy">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <h2 className="lp-h2" data-reveal>{t.title}</h2>
          <p data-reveal style={delay(0.1)}>{t.p}</p>
          <span className="lp-caption" data-reveal style={delay(0.2)}>{t.caption}</span>
        </div>
        <div className="lp-boundary" data-reveal style={delay(0.15)}>
          <span className="lp-boundary-label">{t.boundary}</span>
          <div className="lp-boundary-grid">
            <div className="lp-boundary-cell">{c1}</div>
            <div className="lp-boundary-cell">{c2}</div>
            <div className="lp-boundary-cell agent">
              <span>{c3}</span>
              <i />
            </div>
            <div className="lp-boundary-cell">{c4}</div>
          </div>
          <div className="lp-boundary-foot">
            <span>{t.outbound}</span>
            <span className="val">{t.zero}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
