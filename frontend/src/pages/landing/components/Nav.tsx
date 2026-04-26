import { useEffect, useState } from 'react';
import { COPY, type Lang } from '../i18n';
import { AchillesLogo, I } from '../icons';
import { LangToggle } from './LangToggle';

type Props = {
  lang: Lang;
  setLang: (lang: Lang) => void;
};

const GITHUB_URL = 'https://github.com/projectachilles/ProjectAchilles';
const DOCS_URL = 'https://docs.projectachilles.io';

export function Nav({ lang, setLang }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const t = COPY[lang].nav;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-inner">
        <a className="nav-logo" href="#top">
          <AchillesLogo />
          <span>ACHILLES</span>
        </a>
        <div className="nav-links">
          <a className="nav-link" href="#problem">{t.whyCST}</a>
          <a className="nav-link" href="#regulatory">{t.compliance}</a>
          <a className="nav-link" href="#features">{t.platform}</a>
          <a className="nav-link" href="#how">{t.how}</a>
          <a className="nav-link" href="#mitre">{t.coverage}</a>
          <a className="nav-link" href="#compare">{t.compare}</a>
        </div>
        <div className="nav-right">
          <LangToggle lang={lang} onChange={setLang} />
          <a className="lp-btn lp-btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
            {t.docs}
          </a>
          <a className="lp-btn lp-btn-secondary" href={GITHUB_URL} target="_blank" rel="noreferrer">
            {I.Github} <span style={{ marginLeft: 4 }}>{t.star}</span>
          </a>
          <a className="lp-btn lp-btn-primary" href="#demo">
            {t.cta} {I.Arrow}
          </a>
        </div>
      </div>
    </nav>
  );
}
