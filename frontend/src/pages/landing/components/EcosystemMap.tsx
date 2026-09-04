import { useState, type ReactNode } from 'react';
import { COPY, type Lang, type NodeKey } from '../i18n';
import { EDGES } from '../content';
import { delay } from '../anim';

type NodeProps = {
  id: NodeKey;
  hover: NodeKey | null;
  onHover: (k: NodeKey) => void;
  className?: string;
  children: ReactNode;
};

function Node({ id, hover, onHover, className = '', children }: NodeProps) {
  const isCur = hover === id;
  const linked = !!hover && EDGES[hover].includes(id);
  const faded = !!hover && !isCur && !linked;
  const cls = ['lp-node', className, isCur && 'is-hover', linked && 'is-linked', faded && 'is-faded']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} onMouseEnter={() => onHover(id)}>
      {children}
    </div>
  );
}

const STRIP = Array.from({ length: 12 });

export function EcosystemMap({ lang }: { lang: Lang }) {
  const t = COPY[lang].map;
  const [hover, setHover] = useState<NodeKey | null>(null);
  const cur = hover ? t.nodes[hover] : t.defaultNode;
  const np = { hover, onHover: setHover };

  return (
    <section id="map" className="lp-section">
      <div className="lp-container lp-stack lp-map-sec">
        <div className="lp-head">
          <span className="lp-eyebrow" data-reveal>{t.eyebrow}</span>
          <div className="lp-map-head-body">
            <h2 className="lp-h2" data-reveal>{t.title}</h2>
            <p className="lp-sub" data-reveal style={delay(0.1)}>{t.sub}</p>
          </div>
        </div>
        <div className="lp-map-layout" data-reveal style={delay(0.2)}>
          <div className="lp-map" onMouseLeave={() => setHover(null)}>
            <div className="lp-map-col">{t.layers.validate}</div>
            <div className="lp-map-col">{t.layers.deceive}</div>
            <div className="lp-map-col">{t.layers.test}</div>

            <div className="lp-map-stack">
              <Node id="csv" className="tall" {...np}>
                <span className="name">f0_csv</span>
                <span className="cap">{t.captions.csv}</span>
              </Node>
              <Node id="lib" className="tall" {...np}>
                <span className="name">f0_library</span>
                <span className="cap">{t.captions.lib}</span>
              </Node>
            </div>
            <Node id="hpot" {...np}>
              <span className="name">f0_hpot</span>
              <div className="lp-hpot-grid">
                <span />
                <span><span className="lp-pulse" /></span>
                <span />
                <span />
                <span />
                <span />
                <span><span className="lp-pulse late" /></span>
                <span />
              </div>
              <span className="cap">{t.captions.hpot}</span>
            </Node>
            <div className="lp-map-test">
              <Node id="pentest" className="sm" {...np}>
                <span className="name">f0_<wbr />pentest</span>
                <span className="cap">{t.captions.pentest}</span>
              </Node>
              <Node id="sectools" className="sm" {...np}>
                <span className="name">f0_<wbr />sectools</span>
                <span className="cap">{t.captions.sectools}</span>
              </Node>
              <Node id="hx" className="hx" {...np}>
                <span className="name">hx</span>
                <span className="cap">{t.captions.hx}</span>
              </Node>
            </div>

            <Node id="agent" className="agent" {...np}>
              <span className="name">{t.agentName}</span>
              <span className="cap">{t.agentCap}</span>
            </Node>
            <div className="lp-map-loop">{t.loop}</div>

            <Node id="env" className="env" {...np}>
              <div className="row">
                <span className="name">{t.envName}</span>
                <span className="cap">{t.envCap}</span>
              </div>
              <div className="strip">
                {STRIP.map((_, i) => <span key={i} />)}
              </div>
            </Node>
          </div>

          <div className="lp-panel">
            <span className="layer">{cur.layer}</span>
            <span className="name">{cur.name}</span>
            <p>{cur.text}</p>
            <span className="links">{cur.links}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
