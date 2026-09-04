import { COPY, type Lang } from '../i18n';
import { URLS, WAY_URLS } from '../content';
import { delay } from '../anim';

export function Contribute({ lang }: { lang: Lang }) {
  const t = COPY[lang].contribute;
  return (
    <section id="contribute" className="lp-contrib-sec">
      <div className="lp-container lp-stack lp-contrib">
        <div className="lp-head">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <h2 className="lp-contrib-h2" data-reveal>{t.title}</h2>
        </div>
        <div className="lp-contrib-grid">
          <p className="lp-contrib-lead" data-reveal>{t.lead}</p>
          <div className="lp-ways">
            {t.ways.map((label, i) => (
              <a
                key={i}
                href={WAY_URLS[i]}
                target="_blank"
                rel="noreferrer"
                className="lp-way"
                data-reveal
                style={delay(0.05 * (i + 1))}
              >
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="t">{label}</span>
                <span className="a">→</span>
              </a>
            ))}
          </div>
        </div>
        <div className="lp-ctas" data-reveal>
          <a href={URLS.discussions} target="_blank" rel="noreferrer" className="lp-btn fill">{t.join}</a>
          <a href={URLS.github} target="_blank" rel="noreferrer" className="lp-btn">{t.star}</a>
          <a href={URLS.blog} target="_blank" rel="noreferrer" className="lp-btn">{t.blog}</a>
        </div>
      </div>
    </section>
  );
}
