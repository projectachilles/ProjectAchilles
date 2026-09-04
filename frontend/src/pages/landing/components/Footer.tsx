import { COPY, type Lang } from '../i18n';
import { FOOTER_REPOS, URLS } from '../content';
import { AchillesMark } from './Logo';

export function Footer({ lang }: { lang: Lang }) {
  const t = COPY[lang].footer;
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-stack lp-footer-inner">
        <div className="lp-footer-cols">
          <div className="lp-footer-col">
            <span className="h">{t.repos}</span>
            {FOOTER_REPOS.map((r) => (
              <a key={r.url} href={r.url} target="_blank" rel="noreferrer">{r.label}</a>
            ))}
          </div>
          <div className="lp-footer-col">
            <span className="h">{t.community}</span>
            <a href={URLS.discussions} target="_blank" rel="noreferrer">{t.discussions}</a>
            <a href={URLS.blog} target="_blank" rel="noreferrer">{t.blog}</a>
            <a href={URLS.contributing} target="_blank" rel="noreferrer">{t.contributing}</a>
            <a href={URLS.security} target="_blank" rel="noreferrer">{t.security}</a>
          </div>
          <div className="lp-footer-col start">
            <span className="h">{t.license}</span>
            <span className="lic">{t.licenseName}</span>
            <span className="note">{t.licenseNote}</span>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span className="brand">
            <AchillesMark size={16} />
            {t.copyright}
          </span>
          <span>{t.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
