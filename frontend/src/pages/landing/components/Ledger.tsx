import { COPY, type Lang } from '../i18n';
import { LEDGER_BARS, LEDGER_ROWS } from '../content';

function Square({ hit, missed }: { hit?: boolean; missed?: boolean }) {
  return (
    <span className="cell">
      <span className={`sq${hit ? ' hit' : ''}${missed ? ' missed' : ''}`} />
    </span>
  );
}

/** Hero "f0_csv · detection coverage ledger" card. Data is illustrative. */
export function Ledger({ lang }: { lang: Lang }) {
  const t = COPY[lang].ledger;
  return (
    <div className="lp-ledger">
      <div className="lp-ledger-head">
        <span>{t.title}</span>
        <span>{t.run}</span>
      </div>
      <div className="lp-ledger-cols">
        <span>{t.cols.technique}</span>
        <span>{t.cols.name}</span>
        <span className="c">{t.cols.prev}</span>
        <span className="c">{t.cols.log}</span>
        <span className="c">{t.cols.alert}</span>
        <span className="c">{t.cols.miss}</span>
      </div>
      {LEDGER_ROWS.map((r, i) => (
        <div key={r.id} className={`lp-ledger-row${r.miss ? ' miss' : ''}`}>
          <span>{r.id}</span>
          <span className="name">{t.rows[i]}</span>
          <Square hit={r.prev} />
          <Square hit={r.log} />
          <Square hit={r.alert} />
          <Square missed={r.miss} />
        </div>
      ))}
      <div className="lp-ledger-foot">
        <div className="lp-ledger-cov">
          <span className="lbl">{t.coverage}</span>
          <div className="lp-ledger-bars">
            {LEDGER_BARS.map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="lp-ledger-pct">
          <span className="big">{t.pct}</span>
          <span className="sm">{t.pctLabel}</span>
        </div>
      </div>
    </div>
  );
}
