import { COPY, type Lang } from '../i18n';
import { WHY_BARS } from '../content';
import { delay } from '../anim';

export function Why({ lang }: { lang: Lang }) {
  const t = COPY[lang].why;
  return (
    <section id="why" className="lp-section alt">
      <div className="lp-container lp-stack lp-why">
        <div className="lp-head">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <h2 className="lp-h2 pretty" data-reveal>{t.title}</h2>
        </div>
        <div className="lp-why-grid">
          <div className="lp-bars">
            {WHY_BARS.map((pct, i) => {
              const accent = i === WHY_BARS.length - 1;
              return (
                <div key={i} className={`lp-bar${accent ? ' accent' : ''}`} data-reveal style={delay(0.1 * i)}>
                  <span>{t.bars[i]}</span>
                  <div className="lp-bar-track">
                    <div className="lp-bar-fill" data-grow style={{ width: `${pct}%` }} />
                  </div>
                  <span className="lp-bar-val">{pct}%</span>
                </div>
              );
            })}
            <span className="lp-caption" data-reveal style={delay(0.3)}>{t.source}</span>
          </div>
          <div className="lp-facts">
            {t.facts.map((f, i) => (
              <div key={f.fig} className="lp-fact" data-reveal style={delay(0.1 * (i + 1))}>
                <span className="fig">{f.fig}</span>
                <span className="txt">
                  {f.text}
                  <br />
                  <span className="src">{f.src}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
