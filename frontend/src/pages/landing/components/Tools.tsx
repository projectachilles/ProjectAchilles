import { COPY, type Lang } from '../i18n';
import { TOOLS } from '../content';
import { delay } from '../anim';

export function Tools({ lang }: { lang: Lang }) {
  const t = COPY[lang].tools;
  return (
    <section id="tools" className="lp-section alt">
      <div className="lp-container lp-stack lp-tools-sec">
        <div className="lp-head">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <h2 className="lp-h2" data-reveal>{t.title}</h2>
        </div>
        <div className="lp-tools">
          {TOOLS.map((tool, i) => (
            <a
              key={tool.key}
              href={tool.url}
              target="_blank"
              rel="noreferrer"
              className="lp-tool"
              data-reveal
              style={delay(i * 0.08)}
            >
              <div className="lp-tool-top">
                <span className="layer">{t.layers[tool.layer]}</span>
                <span className={`lp-tool-status${tool.status === 'development' ? ' muted' : ''}`}>
                  {t.status[tool.status]}
                </span>
              </div>
              <div className="lp-tool-mid">
                <span className="lp-tool-name">{tool.name}</span>
                <span className="lp-tool-desc">{t.desc[tool.key]}</span>
              </div>
              <span className="lp-tool-repo">
                <span>{tool.repo}</span>
                <span>→</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
