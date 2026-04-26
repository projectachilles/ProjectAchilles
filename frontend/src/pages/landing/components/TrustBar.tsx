import { COPY, type Lang } from '../i18n';

export function TrustBar({ lang }: { lang: Lang }) {
  const t = COPY[lang].trust;
  return (
    <div className="trust-bar">
      <div className="lp-container">
        <div className="trust-label">{t.label}</div>
        <div className="trust-row">
          <span className="trust-item">MITRE ATT&amp;CK</span>
          <span className="trust-item">DORA</span>
          <span className="trust-item">TIBER-EU</span>
          <span className="trust-item">ISO 27001</span>
          <span className="trust-item">CIS Benchmarks</span>
          <span className="trust-item">ISACA</span>
          <span className="trust-item">FFIEC</span>
        </div>
      </div>
    </div>
  );
}
