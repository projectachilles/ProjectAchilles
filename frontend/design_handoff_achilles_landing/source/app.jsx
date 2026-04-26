/* global React */
const { useState, useEffect, useRef } = React;

// ─── Icon helpers ────────────────────────────────────────────
const Icon = ({ d, size = 18, stroke = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const I = {
  Shield: <Icon d={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>} />,
  Check: <Icon d={<><path d="M20 6 9 17l-5-5"/></>} />,
  Terminal: <Icon d={<><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>} />,
  Zap: <Icon d={<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>} />,
  Lock: <Icon d={<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>} />,
  Layers: <Icon d={<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>} />,
  Server: <Icon d={<><rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><line x1="6" y1="7" x2="6.01" y2="7"/><line x1="6" y1="17" x2="6.01" y2="17"/></>} />,
  Bar: <Icon d={<><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>} />,
  Clock: <Icon d={<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>} />,
  Alert: <Icon d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>} />,
  Off: <Icon d={<><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></>} />,
  Github: <Icon d={<><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></>} />,
  Arrow: <Icon d={<><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>} />,
  Sparkle: <Icon d={<><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></>} />,
  Network: <Icon d={<><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v3M5 16l5-4M19 16l-5-4"/></>} />,
};

const AchillesLogo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 500 500">
    <path fill="var(--accent)" fillRule="evenodd" d="M 250,28 L 480,458 L 20,458 Z M 250,252 L 312,458 L 230,458 L 150,360 L 195,310 L 155,250 Z" />
  </svg>
);

function useReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

// Language toggle button
function LangToggle({ lang, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', border: '1px solid var(--line)',
      borderRadius: 4, overflow: 'hidden', marginRight: '0.25rem',
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
    }}>
      {['en', 'es'].map(l => (
        <button key={l}
          onClick={() => onChange(l)}
          style={{
            padding: '0.4rem 0.65rem',
            background: lang === l ? 'var(--accent-bg)' : 'transparent',
            color: lang === l ? 'var(--accent-bright)' : 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>{l}</button>
      ))}
    </div>
  );
}

function Nav({ lang, setLang }) {
  const [scrolled, setScrolled] = useState(false);
  const t = window.COPY[lang].nav;
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-inner">
        <a className="nav-logo" href="#top">
          <AchillesLogo />
          <span>ACHILLES</span>
        </a>
        <div className="nav-links">
          <a className="nav-link" href="#problem">{t.whyCST}</a>
          <a className="nav-link" href="#regulatory">{t.compliance}</a>
          <a className="nav-link" href="#features">{t.platform}</a>
          <a className="nav-link" href="#how">{t.how}</a>
          <a className="nav-link" href="#mitre">{t.coverage}</a>
          <a className="nav-link" href="#compare">{t.compare}</a>
        </div>
        <div className="nav-right">
          <LangToggle lang={lang} onChange={setLang} />
          <a className="btn btn-ghost" href="https://docs.projectachilles.io" target="_blank" rel="noreferrer">{t.docs}</a>
          <a className="btn btn-secondary" href="https://github.com/projectachilles/ProjectAchilles" target="_blank" rel="noreferrer">
            {I.Github} <span style={{marginLeft: 4}}>{t.star}</span>
          </a>
          <a className="btn btn-primary" href="#demo">{t.cta} {I.Arrow}</a>
        </div>
      </div>
    </nav>
  );
}

function Hero({ lang }) {
  const t = window.COPY[lang].hero;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const tm = setInterval(() => setTick(v => v + 1), 100);
    return () => clearInterval(tm);
  }, [lang]);
  const lines = lang === 'es' ? [
    { type: 'cmt', text: '// ejecución CST · 2026-04-25 · flota productiva (n=247)' },
    { type: 'cmd', text: '$ achilles emulate --campaign apt29 --scope=tier1' },
    { type: 'out', text: '[ingest] 47 TTPs de CISA AA24-241A → MITRE ATT&CK' },
    { type: 'ok',  text: '[exec]  T1059.001 PowerShell ............. DETECTADO' },
    { type: 'ok',  text: '[exec]  T1071.001 C2 sobre HTTPS .......... DETECTADO' },
    { type: 'warn',text: '[exec]  T1027 Ofuscación .............. PARCIAL' },
    { type: 'err', text: '[exec]  T1486 Cifrado de Datos ......... NO DETECTADO' },
    { type: 'ok',  text: '[exec]  T1003.001 LSASS Memory .......... DETECTADO' },
    { type: 'out', text: '[score] Defense 73% · Secure 90.9% · Δ +5.2 / 7d' },
    { type: 'prompt', text: '→ paquete de evidencia · DORA Art.25 · ISO A.5.7 · CIS 18' },
  ] : [
    { type: 'cmt', text: '// CST run · 2026-04-25 · production fleet (n=247)' },
    { type: 'cmd', text: '$ achilles emulate --campaign apt29 --scope=tier1' },
    { type: 'out', text: '[ingest] 47 TTPs from CISA AA24-241A → MITRE ATT&CK' },
    { type: 'ok',  text: '[exec]  T1059.001 PowerShell ............. DETECTED' },
    { type: 'ok',  text: '[exec]  T1071.001 C2 over HTTPS ........... DETECTED' },
    { type: 'warn',text: '[exec]  T1027 Obfuscated Files ....... PARTIAL' },
    { type: 'err', text: '[exec]  T1486 Data Encrypted ............ MISSED' },
    { type: 'ok',  text: '[exec]  T1003.001 LSASS Memory .......... DETECTED' },
    { type: 'out', text: '[score] Defense 73% · Secure 90.9% · Δ +5.2 / 7d' },
    { type: 'prompt', text: '→ evidence packet · DORA Art.25 · ISO A.5.7 · CIS 18' },
  ];
  const visible = Math.min(lines.length, Math.floor(tick / 4));
  return (
    <section className="hero" id="top">
      <div className="container">
        <div className="hero-grid">
          <div className="reveal visible">
            <div className="status-bar">
              <span className="status-dot"></span>
              {t.status}
            </div>
            <h1 className="hero-headline">
              <span className="pre">{t.pre}</span>
              <span className="accent">{t.accent}</span>
            </h1>
            <p className="hero-sub">{t.sub}</p>
            <div className="hero-ctas">
              <a className="btn btn-primary btn-lg" href="#demo">{t.ctaPrimary} {I.Arrow}</a>
              <a className="btn btn-secondary btn-lg" href="https://github.com/projectachilles/ProjectAchilles" target="_blank" rel="noreferrer">
                {I.Github} {t.ctaSecondary}
              </a>
            </div>
            <div className="hero-meta">
              <div className="hero-meta-item"><div className="hero-meta-value">{t.meta1Value}</div><div className="hero-meta-label">{t.meta1Label}</div></div>
              <div className="hero-meta-item"><div className="hero-meta-value">{t.meta2Value}</div><div className="hero-meta-label">{t.meta2Label}</div></div>
              <div className="hero-meta-item"><div className="hero-meta-value">{t.meta3Value}</div><div className="hero-meta-label">{t.meta3Label}</div></div>
            </div>
          </div>

          <div className="reveal visible" style={{position:'relative'}}>
            <div className="hero-viz">
              <div className="viz-header">
                <span className="viz-dot" style={{background:'#ff5f57'}}></span>
                <span className="viz-dot" style={{background:'#febc2e'}}></span>
                <span className="viz-dot" style={{background:'#28c840'}}></span>
                <span className="viz-title">{t.vizTitle}</span>
                <span className="viz-status"><span className="status-dot" style={{width:6,height:6}}></span> {t.vizStatus}</span>
              </div>
              <div className="viz-body">
                {lines.slice(0, visible).map((l, i) => (
                  <span key={i} className={`viz-line viz-${l.type}`}>{l.text}</span>
                ))}
                {visible < lines.length && <span className="viz-cursor"></span>}
              </div>
              <div className="viz-scoreboard">
                <div className="viz-score">
                  <div className="viz-score-label">{t.vizScoreA}</div>
                  <div className="viz-score-value">73%</div>
                  <div className="viz-bar"><div style={{width: visible >= 5 ? '73%' : '0%'}}></div></div>
                </div>
                <div className="viz-score">
                  <div className="viz-score-label">{t.vizScoreB}</div>
                  <div className="viz-score-value">90.9%</div>
                  <div className="viz-bar"><div style={{width: visible >= 5 ? '90.9%' : '0%'}}></div></div>
                </div>
              </div>
            </div>
            <div className="viz-float top">
              <span className="status-dot" style={{width:6,height:6}}></span>
              {t.vizFloatTop}
            </div>
            <div className="viz-float bot">
              <span style={{color:'var(--accent)'}}>{I.Check}</span>
              {t.vizFloatBot}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar({ lang }) {
  const t = window.COPY[lang].trust;
  return (
    <div className="trust-bar">
      <div className="container">
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

function Problem({ lang }) {
  const t = window.COPY[lang].problem;
  const icons = [I.Clock, I.Alert, I.Bar, I.Off];
  return (
    <section id="problem" className="reveal">
      <div className="container">
        <div className="problem-grid">
          <div>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2 className="section-title" style={{margin:'1.25rem 0 1rem'}}>{t.title}</h2>
            <p className="section-sub">{t.sub}</p>
          </div>
          <div className="problem-cards">
            {t.items.map((it, i) => (
              <div key={i} className="problem-card reveal">
                <div className="problem-icon">{icons[i]}</div>
                <div className="problem-title">{it.t}</div>
                <div className="problem-desc">{it.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Regulatory({ lang }) {
  const t = window.COPY[lang].reg;
  const FRAMEWORKS = window.FRAMEWORKS_I18N[lang];
  const [active, setActive] = useState('dora');
  const fw = FRAMEWORKS.find(f => f.id === active);
  const cells = Array.from({ length: 80 }, (_, i) => i < (fw.coverage * 80 / 100));
  return (
    <section id="regulatory" className="reg-section reveal">
      <div className="container">
        <div style={{textAlign:'center', maxWidth: '46rem', margin: '0 auto'}}>
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 className="section-title" style={{margin: '1.25rem 0 1rem'}}>{t.title}</h2>
          <p className="section-sub" style={{margin:'0 auto'}}>{t.sub}</p>
        </div>
        <div className="reg-frameworks reveal">
          {FRAMEWORKS.map(f => (
            <button key={f.id}
              className={`reg-fw ${active === f.id ? 'active' : ''}`}
              onClick={() => setActive(f.id)}>
              <div className="reg-fw-name">{f.name}</div>
              <div className="reg-fw-tag">{f.tag}</div>
              <div className="reg-fw-stat">{f.stat}</div>
            </button>
          ))}
        </div>
        <div className="reg-detail reveal">
          <div>
            <div className="reg-detail-title">{fw.title}</div>
            <p className="reg-detail-desc">{fw.desc}</p>
            <ul className="reg-controls">
              {fw.controls.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
          <div className="reg-coverage">
            <div className="reg-coverage-label">{t.coverage}</div>
            <div className="reg-coverage-value">{fw.coverage}%</div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-muted)', marginTop:4}}>
              {t.coverageNote.replace('{fw}', fw.name)}
            </div>
            <div className="reg-coverage-cells">
              {cells.map((on, i) => <div key={i} className={`reg-coverage-cell ${on ? 'on' : ''}`}></div>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features({ lang }) {
  const t = window.COPY[lang].features;
  const icons = [I.Sparkle, I.Server, I.Bar, I.Terminal, I.Shield, I.Layers];
  return (
    <section id="features" className="reveal">
      <div className="container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{margin:'1.25rem 0 1rem', maxWidth:'30rem'}}>{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="feature-grid">
          {t.items.map((it, i) => (
            <div key={i} className="feature-card reveal">
              <div className="feature-icon">{icons[i]}</div>
              <div className="feature-title">{it.t}</div>
              <div className="feature-desc">{it.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEP_BODIES = {
  en: [
    [
      { t: 'cmt', x: '// 01 · Threat intel ingestion' },
      { t: 'cmd', x: '$ achilles ingest --source cisa-aa24-241a.pdf' },
      { t: 'ok',  x: '[parse] 47 IOCs · 12 ATT&CK techniques' },
      { t: 'ok',  x: '[map]   T1059.001 T1053.005 T1486 T1071.001 ...' },
      { t: 'warn',x: '[ctx]   Threat actor: COZY BEAR (APT29)' },
      { t: 'prompt', x: '→ intel package ready · agent pipeline armed' },
    ],
    [
      { t: 'cmt', x: '// 02 · AI test generation' },
      { t: 'cmd', x: '$ achilles generate --techniques T1059,T1486' },
      { t: 'ok',  x: '[agent-1] Go source · PowerShell exec' },
      { t: 'ok',  x: '[agent-2] Detection rules · Sigma + KQL + EQL' },
      { t: 'ok',  x: '[agent-3] Hardening · PowerShell + Bash' },
      { t: 'ok',  x: '[agent-4] Kill-chain diagram · operator runbook' },
      { t: 'prompt', x: '→ 2 techniques × 19 artifacts = 38 files' },
    ],
    [
      { t: 'cmt', x: '// 03 · Build · sign · attest' },
      { t: 'cmd', x: '$ achilles build --all-platforms --sign' },
      { t: 'ok',  x: '[build] windows/amd64 · 2.1 MB · OK' },
      { t: 'ok',  x: '[build] linux/amd64   · 1.9 MB · OK' },
      { t: 'ok',  x: '[build] darwin/arm64  · 1.8 MB · OK' },
      { t: 'ok',  x: '[sign]  Authenticode + ad-hoc + Ed25519' },
      { t: 'prompt', x: '→ 6 binaries attested · ready to ship' },
    ],
    [
      { t: 'cmt', x: '// 04 · Fleet execution' },
      { t: 'cmd', x: '$ achilles deploy --fleet production' },
      { t: 'ok',  x: '[fleet] 247 endpoints · heartbeat OK' },
      { t: 'ok',  x: '[exec]  T1059.001 ............. DETECTED' },
      { t: 'err', x: '[exec]  T1486 ................ MISSED' },
      { t: 'warn',x: '[score] Defense 73% (+5.2 / 7d)' },
      { t: 'prompt', x: '→ DORA / ISO / CIS evidence packet exported' },
    ],
  ],
  es: [
    [
      { t: 'cmt', x: '// 01 · Ingesta de inteligencia' },
      { t: 'cmd', x: '$ achilles ingest --source cisa-aa24-241a.pdf' },
      { t: 'ok',  x: '[parse] 47 IOCs · 12 técnicas ATT&CK' },
      { t: 'ok',  x: '[map]   T1059.001 T1053.005 T1486 T1071.001 ...' },
      { t: 'warn',x: '[ctx]   Actor: COZY BEAR (APT29)' },
      { t: 'prompt', x: '→ paquete listo · pipeline de agentes armado' },
    ],
    [
      { t: 'cmt', x: '// 02 · Generación con IA' },
      { t: 'cmd', x: '$ achilles generate --techniques T1059,T1486' },
      { t: 'ok',  x: '[agent-1] Código Go · ejecución PowerShell' },
      { t: 'ok',  x: '[agent-2] Reglas de detección · Sigma + KQL + EQL' },
      { t: 'ok',  x: '[agent-3] Hardening · PowerShell + Bash' },
      { t: 'ok',  x: '[agent-4] Diagrama kill-chain · runbook' },
      { t: 'prompt', x: '→ 2 técnicas × 19 artefactos = 38 archivos' },
    ],
    [
      { t: 'cmt', x: '// 03 · Build · firma · attest' },
      { t: 'cmd', x: '$ achilles build --all-platforms --sign' },
      { t: 'ok',  x: '[build] windows/amd64 · 2.1 MB · OK' },
      { t: 'ok',  x: '[build] linux/amd64   · 1.9 MB · OK' },
      { t: 'ok',  x: '[build] darwin/arm64  · 1.8 MB · OK' },
      { t: 'ok',  x: '[sign]  Authenticode + ad-hoc + Ed25519' },
      { t: 'prompt', x: '→ 6 binarios atestados · listos para desplegar' },
    ],
    [
      { t: 'cmt', x: '// 04 · Ejecución en flota' },
      { t: 'cmd', x: '$ achilles deploy --fleet production' },
      { t: 'ok',  x: '[fleet] 247 endpoints · heartbeat OK' },
      { t: 'ok',  x: '[exec]  T1059.001 ............. DETECTADO' },
      { t: 'err', x: '[exec]  T1486 ................ NO DETECTADO' },
      { t: 'warn',x: '[score] Defense 73% (+5.2 / 7d)' },
      { t: 'prompt', x: '→ paquete de evidencia DORA / ISO / CIS exportado' },
    ],
  ],
};

function HowItWorks({ lang }) {
  const t = window.COPY[lang].how;
  const [active, setActive] = useState(0);
  const bodies = STEP_BODIES[lang];
  return (
    <section id="how" className="reveal">
      <div className="container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{margin:'1.25rem 0 1rem', maxWidth:'34rem'}}>{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="pipeline">
          {t.steps.map((s, i) => (
            <button key={i}
              className={`pipeline-step ${active === i ? 'active' : ''}`}
              onClick={() => setActive(i)}>
              <div className="pipeline-num">{t.stage} 0{i + 1}</div>
              <div className="pipeline-title">{s.title}</div>
              <div className="pipeline-desc">{s.desc}</div>
              <div className="pipeline-arrow">→</div>
            </button>
          ))}
        </div>
        <div className="pipeline-detail">
          {bodies[active].map((l, i) => (
            <span key={`${active}-${i}`} className={`viz-line viz-${l.t}`}>{l.x}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function genMatrix() {
  const out = [];
  for (let c = 0; c < 11; c++) {
    const col = [];
    for (let r = 0; r < 8; r++) {
      const v = Math.random();
      const colWeight = (c === 4 || c === 5 || c === 10) ? 0.55 : 0.78;
      let s = 'empty';
      if (v < colWeight * 0.7) s = 'protected';
      else if (v < colWeight * 0.85) s = 'partial';
      else if (v < colWeight) s = 'gap';
      col.push(s);
    }
    out.push(col);
  }
  return out;
}

function MitreMatrix({ lang }) {
  const t = window.COPY[lang].mitre;
  const [filter, setFilter] = useState('all');
  const matrix = useRef(genMatrix()).current;
  const flat = matrix.flat();
  const counts = flat.reduce((a, s) => { a[s] = (a[s] || 0) + 1; return a; }, {});
  const total = flat.filter(s => s !== 'empty').length;
  const filterLabels = {
    all: t.filterAll, protected: t.filterProtected, partial: t.filterPartial, gap: t.filterGap,
  };
  return (
    <section id="mitre" className="reveal">
      <div className="container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{margin:'1.25rem 0 1rem', maxWidth:'34rem'}}>{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="mitre-wrap">
          <div className="mitre-toolbar">
            <div className="mitre-filter">
              {['all','protected','partial','gap'].map(f => (
                <button key={f}
                  className={`mitre-chip ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}>{filterLabels[f]}</button>
              ))}
            </div>
            <div className="mitre-stats">
              <div><span className="mitre-stat-num green">{counts.protected || 0}</span> {t.statProtected}</div>
              <div><span className="mitre-stat-num amber">{counts.partial || 0}</span> {t.statPartial}</div>
              <div><span className="mitre-stat-num red">{counts.gap || 0}</span> {t.statGap}</div>
              <div><span className="mitre-stat-num">{total}</span> {t.statTests}</div>
            </div>
          </div>
          <div className="mitre-grid">
            {t.tactics.map((tname, c) => (
              <div key={tname} className="mitre-col">
                <div className="mitre-col-head">{tname}</div>
                {matrix[c].map((s, r) => {
                  const dim = filter !== 'all' && s !== filter && s !== 'empty';
                  return (
                    <div key={r}
                      className={`mitre-cell ${s}`}
                      style={dim ? { opacity: 0.15 } : undefined}>
                      <div className="mitre-tooltip">T{1000 + c * 8 + r} · {s}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mitre-legend">
            <div className="mitre-legend-item"><span className="mitre-legend-sw" style={{background:'var(--accent)', opacity:0.85}}></span>{t.legendProtected}</div>
            <div className="mitre-legend-item"><span className="mitre-legend-sw" style={{background:'var(--warn)', opacity:0.7}}></span>{t.legendPartial}</div>
            <div className="mitre-legend-item"><span className="mitre-legend-sw" style={{background:'var(--danger)', opacity:0.65}}></span>{t.legendGap}</div>
            <div className="mitre-legend-item"><span className="mitre-legend-sw" style={{background:'rgba(255,255,255,0.04)'}}></span>{t.legendUntested}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Compare({ lang }) {
  const t = window.COPY[lang].compare;
  const cell = (v) => {
    if (v === 'yes') return <span className="compare-mark yes">{I.Check}</span>;
    if (v === 'no') return <span className="compare-mark no">—</span>;
    if (v === 'partial') return <span className="compare-mark partial">◐</span>;
    return v;
  };
  return (
    <section id="compare" className="reveal">
      <div className="container">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 className="section-title" style={{margin:'1.25rem 0 1rem', maxWidth:'36rem'}}>{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="compare-table">
          <div className="compare-row head">
            <div className="compare-cell">{t.colCap}</div>
            <div className="compare-cell us">{t.colUs}</div>
            <div className="compare-cell">AttackIQ</div>
            <div className="compare-cell">SafeBreach</div>
            <div className="compare-cell">Picus</div>
          </div>
          {t.rows.map((row, i) => (
            <div key={i} className="compare-row">
              <div className="compare-cell label">{row[0]}</div>
              <div className="compare-cell us">{cell(row[1])}</div>
              <div className="compare-cell">{cell(row[2])}</div>
              <div className="compare-cell">{cell(row[3])}</div>
              <div className="compare-cell">{cell(row[4])}</div>
            </div>
          ))}
        </div>
        <p style={{marginTop:'1rem', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-muted)'}}>{t.footnote}</p>
      </div>
    </section>
  );
}

function Security({ lang }) {
  const t = window.COPY[lang].security;
  const icons = [I.Lock, I.Shield, I.Clock, I.Zap, I.Network, I.Bar];
  return (
    <section className="reveal">
      <div className="container">
        <div className="security-block">
          <div style={{textAlign:'center', marginBottom:'1.5rem'}}>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2 className="section-title" style={{margin:'1.25rem 0 0.5rem', fontSize:'2rem'}}>{t.title}</h2>
            <p className="section-sub" style={{margin:'0 auto'}}>{t.sub}</p>
          </div>
          <div className="security-grid">
            {t.items.map((label, i) => (
              <div key={i} className="security-item">{icons[i]}{label}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA({ lang }) {
  const t = window.COPY[lang].cta;
  return (
    <section id="demo" className="reveal">
      <div className="container">
        <div className="cta-block">
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 className="section-title" style={{margin:'1.5rem 0 1rem', fontSize:'clamp(2rem, 4.5vw, 3.25rem)'}}>
            {t.titleA}<br/>
            <span style={{color:'var(--accent-bright)', fontFamily:'var(--font-display)'}}>{t.titleB}</span>
          </h2>
          <p className="section-sub" style={{margin:'0 auto 2rem'}}>{t.sub}</p>
          <div style={{display:'flex', gap:'0.75rem', justifyContent:'center', flexWrap:'wrap'}}>
            <a className="btn btn-primary btn-lg" href="#">{t.primary} {I.Arrow}</a>
            <a className="btn btn-secondary btn-lg" href="https://github.com/projectachilles/ProjectAchilles" target="_blank" rel="noreferrer">
              {I.Github} {t.secondary}
            </a>
            <a className="btn btn-ghost btn-lg" href="https://discord.gg/aZ2dx2p4Ef" target="_blank" rel="noreferrer">
              {t.tertiary}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ lang }) {
  const t = window.COPY[lang].footer;
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="nav-logo" style={{marginBottom:'1rem'}}>
              <AchillesLogo />
              <span>ACHILLES</span>
            </div>
            <p style={{color:'var(--text-muted)', fontSize:14, lineHeight:1.6, maxWidth:'24rem'}}>{t.tagline}</p>
          </div>
          <div>
            <div className="footer-col-title">{t.colPlatform}</div>
            <a className="footer-link" href="#features">{t.links.features}</a>
            <a className="footer-link" href="#how">{t.links.how}</a>
            <a className="footer-link" href="#mitre">{t.links.coverage}</a>
            <a className="footer-link" href="#compare">{t.links.compare}</a>
          </div>
          <div>
            <div className="footer-col-title">{t.colCompliance}</div>
            <a className="footer-link" href="#regulatory">DORA</a>
            <a className="footer-link" href="#regulatory">TIBER-EU</a>
            <a className="footer-link" href="#regulatory">ISO 27001</a>
            <a className="footer-link" href="#regulatory">CIS Controls</a>
          </div>
          <div>
            <div className="footer-col-title">{t.colCommunity}</div>
            <a className="footer-link" href="https://github.com/projectachilles/ProjectAchilles" target="_blank" rel="noreferrer">{t.links.github}</a>
            <a className="footer-link" href="https://discord.gg/aZ2dx2p4Ef" target="_blank" rel="noreferrer">{t.links.discord}</a>
            <a className="footer-link" href="https://docs.projectachilles.io" target="_blank" rel="noreferrer">{t.links.docs}</a>
            <a className="footer-link" href="#">{t.links.security}</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>{t.copyright}</span>
          <span>{t.bottomTag}</span>
        </div>
      </div>
    </footer>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "editorial",
  "density": "default",
  "lang": "en",
  "showCompare": true,
  "showRegulatory": true,
  "showSecurity": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [lang, setLang] = useState(tweaks.lang || 'en');
  useReveal();

  useEffect(() => {
    document.documentElement.className =
      `theme-${tweaks.theme} density-${tweaks.density}`;
  }, [tweaks.theme, tweaks.density]);

  // Keep lang state and tweak.lang in sync
  useEffect(() => { if (tweaks.lang && tweaks.lang !== lang) setLang(tweaks.lang); }, [tweaks.lang]);
  const onSetLang = (l) => { setLang(l); setTweak('lang', l); };

  const tw = window.COPY[lang].tweaks;

  return (
    <>
      <div className="page-bg"></div>
      <Nav lang={lang} setLang={onSetLang} />
      <Hero lang={lang} />
      <TrustBar lang={lang} />
      {tweaks.showRegulatory && <Regulatory lang={lang} />}
      <Problem lang={lang} />
      <Features lang={lang} />
      <HowItWorks lang={lang} />
      <MitreMatrix lang={lang} />
      {tweaks.showCompare && <Compare lang={lang} />}
      {tweaks.showSecurity && <Security lang={lang} />}
      <FinalCTA lang={lang} />
      <Footer lang={lang} />

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label={tw.direction}>
          <window.TweakRadio
            label={tw.language}
            value={lang}
            options={[{value:'en', label:'EN'},{value:'es', label:'ES'}]}
            onChange={onSetLang}
          />
          <window.TweakSelect
            label={tw.theme}
            value={tweaks.theme}
            options={[
              { value: 'editorial', label: tw.themeEditorial },
              { value: 'tactical',  label: tw.themeTactical },
              { value: 'classical', label: tw.themeClassical },
            ]}
            onChange={(v) => setTweak('theme', v)}
          />
          <window.TweakRadio
            label={tw.density}
            value={tweaks.density}
            options={[
              { value: 'compact', label: tw.compact },
              { value: 'default', label: tw.default },
              { value: 'spacious', label: tw.spacious },
            ]}
            onChange={(v) => setTweak('density', v)}
          />
        </window.TweakSection>
        <window.TweakSection label={tw.sections}>
          <window.TweakToggle label={tw.togRegulatory} value={tweaks.showRegulatory} onChange={(v) => setTweak('showRegulatory', v)} />
          <window.TweakToggle label={tw.togCompare} value={tweaks.showCompare} onChange={(v) => setTweak('showCompare', v)} />
          <window.TweakToggle label={tw.togSecurity} value={tweaks.showSecurity} onChange={(v) => setTweak('showSecurity', v)} />
        </window.TweakSection>
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
