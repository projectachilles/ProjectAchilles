import { useEffect, useState } from 'react';
import { COPY, HERO_TERMINAL_LINES, type Lang } from '../i18n';
import { I } from '../icons';
import { isAppMode } from '@/lib/siteMode';

const GITHUB_URL = 'https://github.com/projectachilles/ProjectAchilles';
const GET_STARTED_URL = 'https://docs.projectachilles.io/docs/getting-started/introduction';
const SIGN_IN_URL = '/sign-in';

export function Hero({ lang }: { lang: Lang }) {
  const t = COPY[lang].hero;
  const lines = HERO_TERMINAL_LINES[lang];
  const [tick, setTick] = useState(0);
  const ctaLabel = isAppMode ? COPY[lang].signIn : t.ctaPrimary;
  const ctaHref = isAppMode ? SIGN_IN_URL : GET_STARTED_URL;

  useEffect(() => {
    setTick(0);
    const id = setInterval(() => setTick((v) => v + 1), 100);
    return () => clearInterval(id);
  }, [lang]);

  // Reveal a new line every 4 ticks (~400ms). Cap at total length.
  const visible = Math.min(lines.length, Math.floor(tick / 4));

  return (
    <section className="hero" id="top">
      <div className="lp-container">
        <div className="hero-grid">
          <div className="reveal visible">
            <div className="status-bar">
              <span className="status-dot" />
              {t.status}
            </div>
            <h1 className="hero-headline">
              <span className="pre">{t.pre}</span>
              <span className="accent">{t.accent}</span>
            </h1>
            <p className="hero-sub">{t.sub}</p>
            <div className="hero-ctas">
              <a
                className="lp-btn lp-btn-primary lp-btn-lg"
                href={ctaHref}
                {...(isAppMode ? {} : { target: '_blank', rel: 'noreferrer' })}
              >
                {ctaLabel} {I.Arrow}
              </a>
              <a
                className="lp-btn lp-btn-secondary lp-btn-lg"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
              >
                {I.Github} {t.ctaSecondary}
              </a>
            </div>
            <div className="hero-meta">
              <div className="hero-meta-item">
                <div className="hero-meta-value">{t.meta1Value}</div>
                <div className="hero-meta-label">{t.meta1Label}</div>
              </div>
              <div className="hero-meta-item">
                <div className="hero-meta-value">{t.meta2Value}</div>
                <div className="hero-meta-label">{t.meta2Label}</div>
              </div>
              <div className="hero-meta-item">
                <div className="hero-meta-value">{t.meta3Value}</div>
                <div className="hero-meta-label">{t.meta3Label}</div>
              </div>
            </div>
          </div>

          <div className="reveal visible" style={{ position: 'relative' }}>
            <div className="hero-viz">
              <div className="viz-header">
                <span className="viz-dot" style={{ background: '#ff5f57' }} />
                <span className="viz-dot" style={{ background: '#febc2e' }} />
                <span className="viz-dot" style={{ background: '#28c840' }} />
                <span className="viz-title">{t.vizTitle}</span>
                <span className="viz-status">
                  <span className="status-dot" style={{ width: 6, height: 6 }} /> {t.vizStatus}
                </span>
              </div>
              <div className="viz-body">
                {lines.slice(0, visible).map((l, i) => (
                  <span key={i} className={`viz-line viz-${l.type}`}>
                    {l.text}
                  </span>
                ))}
                {visible < lines.length && <span className="viz-cursor" />}
              </div>
              <div className="viz-scoreboard">
                <div className="viz-score">
                  <div className="viz-score-label">{t.vizScoreA}</div>
                  <div className="viz-score-value">73%</div>
                  <div className="viz-bar">
                    <div style={{ width: visible >= 5 ? '73%' : '0%' }} />
                  </div>
                </div>
                <div className="viz-score">
                  <div className="viz-score-label">{t.vizScoreB}</div>
                  <div className="viz-score-value">90.9%</div>
                  <div className="viz-bar">
                    <div style={{ width: visible >= 5 ? '90.9%' : '0%' }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="viz-float top">
              <span className="status-dot" style={{ width: 6, height: 6 }} />
              {t.vizFloatTop}
            </div>
            <div className="viz-float bot">
              <span style={{ color: 'var(--accent)' }}>{I.Check}</span>
              {t.vizFloatBot}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
