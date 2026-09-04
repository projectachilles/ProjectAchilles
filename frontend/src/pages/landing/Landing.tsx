import { useEffect, useState } from 'react';
import './landing.css';
import type { Lang } from './i18n';
import { useReveal } from './useReveal';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Marquee } from './components/Marquee';
import { Manifesto } from './components/Manifesto';
import { Why } from './components/Why';
import { EcosystemMap } from './components/EcosystemMap';
import { Tools } from './components/Tools';
import { LocalAI } from './components/LocalAI';
import { Contribute } from './components/Contribute';
import { Roadmap } from './components/Roadmap';
import { Footer } from './components/Footer';

function detectInitialLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const primary = (navigator.language || 'en').toLowerCase();
  return primary.startsWith('es') ? 'es' : 'en';
}

/**
 * Public landing: the ProjectAchilles open-source ecosystem page.
 * Served as the whole app in marketing mode and at "/" in app mode.
 */
export default function Landing() {
  const [lang, setLang] = useState<Lang>(detectInitialLang);
  useReveal();

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.lang;
    html.lang = lang;
    return () => {
      html.lang = prev;
    };
  }, [lang]);

  return (
    <div className="landing-page">
      <Nav lang={lang} setLang={setLang} />
      <Hero lang={lang} />
      <Marquee lang={lang} />
      <Manifesto lang={lang} />
      <Why lang={lang} />
      <EcosystemMap lang={lang} />
      <Tools lang={lang} />
      <LocalAI lang={lang} />
      <Contribute lang={lang} />
      <Roadmap lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}
