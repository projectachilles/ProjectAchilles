import { COPY, type Lang } from '../i18n';
import { I } from '../icons';

const GITHUB_URL = 'https://github.com/projectachilles/ProjectAchilles';
const DISCORD_URL = 'https://discord.gg/aZ2dx2p4Ef';
const GET_STARTED_URL = 'https://docs.projectachilles.io/docs/getting-started/introduction';

export function FinalCTA({ lang }: { lang: Lang }) {
  const t = COPY[lang].cta;
  return (
    <section id="demo" className="reveal">
      <div className="lp-container">
        <div className="cta-block">
          <span className="eyebrow">{t.eyebrow}</span>
          <h2
            className="section-title"
            style={{ margin: '1.5rem 0 1rem', fontSize: 'clamp(2rem, 4.5vw, 3.25rem)' }}
          >
            {t.titleA}
            <br />
            <span style={{ color: 'var(--accent-bright)', fontFamily: 'var(--font-display)' }}>
              {t.titleB}
            </span>
          </h2>
          <p className="section-sub" style={{ margin: '0 auto 2rem' }}>
            {t.sub}
          </p>
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <a
              className="lp-btn lp-btn-primary lp-btn-lg"
              href={GET_STARTED_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.primary} {I.Arrow}
            </a>
            <a
              className="lp-btn lp-btn-secondary lp-btn-lg"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              {I.Github} {t.secondary}
            </a>
            <a
              className="lp-btn lp-btn-ghost lp-btn-lg"
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.tertiary}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
