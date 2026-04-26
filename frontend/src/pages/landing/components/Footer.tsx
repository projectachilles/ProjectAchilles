import { COPY, type Lang } from '../i18n';
import { AchillesLogo } from '../icons';

const GITHUB_URL = 'https://github.com/projectachilles/ProjectAchilles';
const DISCORD_URL = 'https://discord.gg/aZ2dx2p4Ef';
const DOCS_URL = 'https://docs.projectachilles.io';

export function Footer({ lang }: { lang: Lang }) {
  const t = COPY[lang].footer;
  return (
    <footer>
      <div className="lp-container">
        <div className="footer-grid">
          <div>
            <div className="nav-logo" style={{ marginBottom: '1rem' }}>
              <AchillesLogo />
              <span>ACHILLES</span>
            </div>
            <p className="footer-tagline">{t.tagline}</p>
          </div>
          <div>
            <div className="footer-col-title">{t.colPlatform}</div>
            <a className="footer-link" href="#features">{t.links.features}</a>
            <a className="footer-link" href="#how">{t.links.how}</a>
            <a className="footer-link" href="#mitre">{t.links.coverage}</a>
            <a className="footer-link" href="#compare">{t.links.compare}</a>
          </div>
          <div>
            <div className="footer-col-title">{t.colCompliance}</div>
            <a className="footer-link" href="#regulatory">DORA</a>
            <a className="footer-link" href="#regulatory">TIBER-EU</a>
            <a className="footer-link" href="#regulatory">ISO 27001</a>
            <a className="footer-link" href="#regulatory">CIS Controls</a>
          </div>
          <div>
            <div className="footer-col-title">{t.colCommunity}</div>
            <a className="footer-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
              {t.links.github}
            </a>
            <a className="footer-link" href={DISCORD_URL} target="_blank" rel="noreferrer">
              {t.links.discord}
            </a>
            <a className="footer-link" href={DOCS_URL} target="_blank" rel="noreferrer">
              {t.links.docs}
            </a>
            <a className="footer-link" href="#">{t.links.security}</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>{t.copyright}</span>
          <span>{t.bottomTag}</span>
        </div>
      </div>
    </footer>
  );
}
