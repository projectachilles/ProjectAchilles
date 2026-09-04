import { COPY, type Lang } from '../i18n';
import { delay } from '../anim';

export function Marquee({ lang }: { lang: Lang }) {
  const items = COPY[lang].marquee;
  // Duplicated once so the -50% translate loops seamlessly.
  const loop = [...items, ...items];
  return (
    <div className="lp-marquee" data-anim="in" style={delay(1.3)}>
      <div className="lp-marquee-track">
        {loop.map((item, i) => (
          <span key={i} style={{ display: 'contents' }}>
            <span>{item}</span>
            <i>·</i>
          </span>
        ))}
      </div>
    </div>
  );
}
