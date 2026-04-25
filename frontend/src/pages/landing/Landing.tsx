import { useEffect, useState } from 'react';
import './landing.css';
import type { Lang } from './i18n';
import { useReveal } from './useReveal';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { TrustBar } from './components/TrustBar';
import { Regulatory } from './components/Regulatory';
import { Problem } from './components/Problem';
import { Features } from './components/Features';
import { HowItWorks } from './components/HowItWorks';
import { MitreMatrix } from './components/MitreMatrix';
import { Compare } from './components/Compare';
import { Security } from './components/Security';
import { FinalCTA } from './components/FinalCTA';
import { Footer } from './components/Footer';

function detectInitialLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const primary = (navigator.language || 'en').toLowerCase();
  return primary.startsWith('es') ? 'es' : 'en';
}

export default function Landing() {
  const [lang, setLang] = useState<Lang>(detectInitialLang);
  useReveal();

  // Marketing landing is dark-only by design — set the html class so any
  // Tailwind utilities used inside (none today, but possible later) pick up
  // the dark variant. Restore on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains('dark');
    html.classList.add('dark');
    return () => {
      if (!hadDark) html.classList.remove('dark');
    };
  }, []);

  return (
    <div className="landing-page">
      <div className="page-bg" />
      <Nav lang={lang} setLang={setLang} />
      <Hero lang={lang} />
      <TrustBar lang={lang} />
      <Regulatory lang={lang} />
      <Problem lang={lang} />
      <Features lang={lang} />
      <HowItWorks lang={lang} />
      <MitreMatrix lang={lang} />
      <Compare lang={lang} />
      <Security lang={lang} />
      <FinalCTA lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}
