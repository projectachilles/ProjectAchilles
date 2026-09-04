import { Fragment } from 'react';
import { COPY, type Lang } from '../i18n';
import { ROADMAP_ACCENT, ROADMAP_PROGRESS, URLS } from '../content';
import { delay } from '../anim';

export function Roadmap({ lang }: { lang: Lang }) {
  const t = COPY[lang].roadmap;
  return (
    <section id="roadmap" className="lp-section">
      <div className="lp-container lp-stack lp-roadmap">
        <div className="lp-head">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <h2 className="lp-h2" data-reveal>{t.title}</h2>
        </div>
        <div className="lp-roadmap-body">
          <div className="lp-progress" data-reveal>
            <div className="lp-progress-fill" data-grow style={{ width: `${ROADMAP_PROGRESS}%` }} />
          </div>
          <div className="lp-phases">
            {t.phases.map((ph, i) => (
              <div key={i} className="lp-phase" data-reveal style={delay(0.1 * (i + 1))}>
                <span className={`st${ROADMAP_ACCENT[i] ? '' : ' muted'}`}>{ph.status}</span>
                <span className="items">
                  {ph.items.map((item, j) => (
                    <Fragment key={item}>
                      {j > 0 && <br />}
                      {item}
                    </Fragment>
                  ))}
                </span>
                <span className="d">{ph.desc}</span>
              </div>
            ))}
          </div>
          <a href={URLS.roadmap} target="_blank" rel="noreferrer" className="lp-roadmap-link" data-reveal>
            {t.link}
          </a>
        </div>
      </div>
    </section>
  );
}
