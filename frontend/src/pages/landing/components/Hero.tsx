import { useRef } from 'react';
import { COPY, type Lang } from '../i18n';
import { delay } from '../anim';
import { useDotField } from '../useDotField';
import { Ledger } from './Ledger';
import { Terminal } from './Terminal';

export function Hero({ lang }: { lang: Lang }) {
  const t = COPY[lang].hero;
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useDotField(canvasRef, sectionRef);

  return (
    <section id="top" className="lp-hero" ref={sectionRef}>
      <div className="lp-hero-canvas-wrap">
        <canvas ref={canvasRef} className="lp-hero-canvas" />
      </div>
      <div className="lp-hero-glow" />
      <div className="lp-hero-grid">
        <div className="lp-hero-copy">
          <div className="lp-hero-eyebrow" data-anim="up" style={delay(0.2)}>
            <span className="lp-glow-dot" />
            <span>{t.eyebrow}</span>
          </div>
          <h1>
            <span data-anim="up" style={delay(0.35)}>{t.h1a}</span>
            <span data-anim="up" style={delay(0.5)}>{t.h1b}</span>
            <span data-anim="up" className="accent" style={delay(0.65)}>{t.h1c}</span>
          </h1>
          <div className="lp-hero-sub-wrap">
            <p className="lp-hero-sub" data-anim="up" style={delay(0.9)}>{t.sub}</p>
          </div>
        </div>
        <div className="lp-hero-visual" data-anim="in" style={delay(0.8)}>
          <Ledger lang={lang} />
          <Terminal lang={lang} />
        </div>
      </div>
    </section>
  );
}
