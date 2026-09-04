import { COPY, type Lang } from '../i18n';
import { URLS } from '../content';
import { AchillesMark } from './Logo';
import { LangToggle } from './LangToggle';
import { isAppMode } from '@/lib/siteMode';

type Props = {
  lang: Lang;
  setLang: (lang: Lang) => void;
};

export function Nav({ lang, setLang }: Props) {
  const t = COPY[lang].nav;
  // On a deployed instance the landing sits at "/" in front of the app, so the
  // primary CTA becomes "sign in"; the marketing site keeps the community CTA.
  const ctaLabel = isAppMode ? COPY[lang].signIn : t.cta;
  const ctaHref = isAppMode ? URLS.signIn : URLS.discussions;

  return (
    <nav className="lp-nav" data-anim="in">
      <a href="#top" className="lp-nav-brand">
        <AchillesMark size={26} />
        <span>PROJECTACHILLES</span>
      </a>
      <div className="lp-nav-links">
        <a href="#why">{t.why}</a>
        <a href="#map">{t.ecosystem}</a>
        <a href="#tools">{t.tools}</a>
        <a href="#local">{t.local}</a>
        <a href="#contribute">{t.contribute}</a>
        <a href="#roadmap">{t.roadmap}</a>
      </div>
      <div className="lp-nav-right">
        <LangToggle lang={lang} onChange={setLang} />
        <a
          className="lp-nav-cta"
          href={ctaHref}
          {...(isAppMode ? {} : { target: '_blank', rel: 'noreferrer' })}
        >
          {ctaLabel}
        </a>
      </div>
    </nav>
  );
}
