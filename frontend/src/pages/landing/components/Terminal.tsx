import { useEffect, useState } from 'react';
import { COPY, type Lang } from '../i18n';
import { delay } from '../anim';

const INTERVAL_MS = 1400;
const MAX_VISIBLE = 4;

/**
 * Hero terminal card. Cycles through the scripted lines showing up to four at
 * a time, then drains back to an empty prompt before restarting — the same
 * (tick % (n + 3)) window as the reference.
 */
export function Terminal({ lang }: { lang: Lang }) {
  const t = COPY[lang].terminal;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const n = t.lines.length;
  const count = (tick % (n + 3)) + 1;
  const shown = Math.min(MAX_VISIBLE, count);
  const start = Math.max(0, count - MAX_VISIBLE);
  const lines = t.lines.slice(start, start + shown);

  return (
    <div className="lp-term" data-anim="up" style={delay(1.1)}>
      <span className="lp-term-head">
        <span>{t.host}</span>
        <span className="live">{t.live}</span>
      </span>
      {lines.map((ln) => (
        <span key={ln.text} className={`lp-term-line ${ln.tone}`}>
          {ln.text}
        </span>
      ))}
      <span className="lp-term-cursor">
        <span>›</span>
        <i />
      </span>
    </div>
  );
}
