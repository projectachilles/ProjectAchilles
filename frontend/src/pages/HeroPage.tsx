import '../styles/hero.css';
import { useState, useEffect, useRef } from "react";
import {
  Shield,
  Cpu,
  BarChart3,
  Terminal,
  Target,
  GitBranch,
  Zap,
  Eye,
  Lock,
  BookOpen,
  LogIn,
  ArrowRight,
  ChevronDown,
  Layers,
  Gauge,
  Bug,
  Network,
  Clock,
  ShieldAlert,
  EyeOff,
  Sparkles,
  Bot,
  FileCode,
  Server,
  Activity,
} from "lucide-react";
import CyberVisualization from "@/components/hero/CyberVisualization";
import { isAppMode } from "@/lib/siteMode";

// ═══════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════

type Lang = "en" | "es";

const GITHUB_URL = "https://github.com/projectachilles/ProjectAchilles";
const DISCORD_URL = "https://discord.gg/4qzwX9XA";

function tx(obj: { en: string; es: string }, lang: Lang) {
  return obj[lang];
}

// ═══════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════

function useTypewriter(text: string, speed = 50, startDelay = 800) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, speed);
      return () => clearInterval(interval);
    }, startDelay);
    return () => clearTimeout(timeout);
  }, [text, speed, startDelay]);

  return { displayed, done };
}

function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
          }
        });
      },
      { threshold: 0.08 },
    );

    document
      .querySelectorAll(".reveal-section")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useAnimatedCounter(target: number, duration = 2000, startDelay = 0) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;
          const delay = setTimeout(() => {
            const start = performance.now();
            const animate = (now: number) => {
              const progress = Math.min((now - start) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(Math.round(eased * target));
              if (progress < 1) requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
          }, startDelay);
          return () => clearTimeout(delay);
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration, startDelay]);

  return { value, ref };
}

function useParallax() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const onScroll = () => setOffset(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return offset;
}

// ═══════════════════════════════════════════════════════════════
// FLOATING PARTICLES BACKGROUND
// ═══════════════════════════════════════════════════════════════

function FloatingParticles() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    duration: `${8 + Math.random() * 12}s`,
    delay: `${Math.random() * 10}s`,
    drift: `${(Math.random() - 0.5) * 100}px`,
    size: Math.random() > 0.7 ? 3 : 2,
  }));

  return (
    <div className="hero-particles">
      {particles.map((p) => (
        <div
          key={p.id}
          className="hero-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            ["--duration" as string]: p.duration,
            ["--delay" as string]: p.delay,
            ["--drift" as string]: p.drift,
          }}
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MITRE ATT&CK MATRIX VISUALIZATION
// ═══════════════════════════════════════════════════════════════

function MitreGrid() {
  const tactics = [
    "Initial Access",
    "Execution",
    "Persistence",
    "Priv. Esc.",
    "Def. Evasion",
    "Credential",
    "Discovery",
    "Lat. Movement",
    "Collection",
    "Exfiltration",
    "Impact",
  ];

  // Compact grid — 3 rows per tactic column for a concise overview
  const grid = useRef(
    Array.from({ length: 11 }, () =>
      Array.from({ length: 3 }, () => {
        const r = Math.random();
        if (r < 0.4) return "protected";
        if (r < 0.55) return "partial";
        if (r < 0.7) return "gap";
        return "empty";
      }),
    ),
  ).current;

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Tactic headers */}
        <div className="grid grid-cols-11 gap-1 mb-2">
          {tactics.map((t) => (
            <div
              key={t}
              className="text-center text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-[var(--hero-text-muted)] truncate px-0.5"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {t}
            </div>
          ))}
        </div>
        {/* Cells */}
        <div className="grid grid-cols-11 gap-1">
          {grid.flat().map((cell, i) => (
            <div
              key={i}
              className={`mitre-cell mitre-cell-${cell}`}
              style={{
                animationDelay: `${i * 15}ms`,
                ["--cell-opacity" as string]:
                  cell === "protected"
                    ? "0.85"
                    : cell === "partial"
                      ? "0.65"
                      : "0.45",
              }}
            />
          ))}
        </div>
        {/* Legend */}
        <div className="flex gap-6 mt-4 justify-center">
          {[
            { color: "var(--hero-accent)", label: "Protected" },
            { color: "var(--hero-warn)", label: "Partial" },
            { color: "var(--hero-danger)", label: "Gap" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ background: item.color, opacity: 0.8 }}
              />
              <span className="text-[10px] text-[var(--hero-text-muted)] uppercase tracking-widest hero-mono">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ANIMATED TERMINAL
// ═══════════════════════════════════════════════════════════════

// Terminal content per pipeline step
type TermLine = { type: "comment" | "command" | "output" | "blank"; text: string; color?: string };

const pipelineTerminals: Record<number, TermLine[]> = {
  0: [
    { type: "comment", text: "// Phase 1: Threat Intelligence Ingestion" },
    { type: "command", text: "$ achilles ingest --source APT29-report.pdf" },
    { type: "output", text: "[parse] Extracting IOCs, TTPs, and threat actor context...", color: "var(--hero-accent)" },
    { type: "output", text: "[map] 12 MITRE ATT&CK techniques identified", color: "var(--hero-accent)" },
    { type: "output", text: "[map] T1059.001 T1053.005 T1486 T1071.001 T1027 ...", color: "var(--hero-accent-bright)" },
    { type: "output", text: "[ctx] Threat Actor: COZY BEAR (APT29)", color: "var(--hero-warn)" },
    { type: "output", text: "[ctx] Severity: CRITICAL — Active campaigns targeting finance sector", color: "var(--hero-danger)" },
    { type: "blank", text: "" },
    { type: "output", text: "[done] Intelligence package ready for AI analysis", color: "var(--hero-accent-bright)" },
  ],
  1: [
    { type: "comment", text: "// Phase 2: AI-Powered Test Generation" },
    { type: "command", text: "$ achilles generate --techniques T1059,T1486,T1053" },
    { type: "output", text: "[ai] Spawning multi-agent pipeline...", color: "var(--hero-accent)" },
    { type: "output", text: "[agent-1] Generating Go source for T1059.001 PowerShell Execution", color: "var(--hero-accent)" },
    { type: "output", text: "[agent-2] Writing detection rules (KQL, YARA, Sigma, EQL)", color: "var(--hero-accent)" },
    { type: "output", text: "[agent-3] Creating hardening scripts (PowerShell + Bash)", color: "var(--hero-accent)" },
    { type: "output", text: "[agent-4] Building kill chain diagram + documentation", color: "var(--hero-accent)" },
    { type: "blank", text: "" },
    { type: "output", text: "[done] 3 techniques x 19 artifacts = 57 files generated", color: "var(--hero-accent-bright)" },
  ],
  2: [
    { type: "comment", text: "// Phase 3: Cross-Platform Compilation" },
    { type: "command", text: "$ achilles build --all-platforms" },
    { type: "output", text: "[build] Compiling T1059_powershell_exec.go", color: "var(--hero-accent)" },
    { type: "output", text: "  ├── windows/amd64  ...  OK (2.1 MB)", color: "var(--hero-accent)" },
    { type: "output", text: "  ├── linux/amd64    ...  OK (1.9 MB)", color: "var(--hero-accent)" },
    { type: "output", text: "  ├── darwin/amd64   ...  OK (2.0 MB)", color: "var(--hero-accent)" },
    { type: "output", text: "  └── darwin/arm64   ...  OK (1.8 MB)", color: "var(--hero-accent)" },
    { type: "blank", text: "" },
    { type: "output", text: "[done] 6 binaries compiled (CGO_ENABLED=0, static)", color: "var(--hero-accent-bright)" },
  ],
  3: [
    { type: "comment", text: "// Phase 4: Signing & Deployment" },
    { type: "command", text: "$ achilles sign --deploy production" },
    { type: "output", text: "[sign] Windows: Authenticode (osslsigncode + PFX cert)", color: "var(--hero-accent)" },
    { type: "output", text: "[sign] macOS: ad-hoc code signature (rcodesign)", color: "var(--hero-accent)" },
    { type: "output", text: "[verify] SHA256 + Ed25519 detached signatures generated", color: "var(--hero-accent)" },
    { type: "blank", text: "" },
    { type: "command", text: "$ achilles deploy --fleet production" },
    { type: "output", text: "[agent] 47 endpoints enrolled, heartbeat OK", color: "var(--hero-accent)" },
    { type: "output", text: "[exec] T1059.001 PowerShell Execution... DETECTED", color: "var(--hero-accent-bright)" },
    { type: "output", text: "[exec] T1486 Data Encrypted for Impact... MISSED", color: "var(--hero-danger)" },
    { type: "output", text: "[score] Defense Score: 73% (+5% from last week)", color: "var(--hero-warn)" },
  ],
};

function PipelineTerminal({ activeStep }: { activeStep: number }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const lines = pipelineTerminals[activeStep] || pipelineTerminals[0];
  const prevStep = useRef(activeStep);

  useEffect(() => {
    // Reset and animate when step changes
    if (activeStep !== prevStep.current) {
      prevStep.current = activeStep;
      setVisibleLines(0);
    }
    let line = 0;
    const interval = setInterval(() => {
      line++;
      setVisibleLines(line);
      if (line >= lines.length) clearInterval(interval);
    }, 120);
    return () => clearInterval(interval);
  }, [activeStep, lines.length]);

  return (
    <div className="hero-terminal">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
        <span className="hero-terminal-dot" style={{ background: "#ff5f57" }} />
        <span className="hero-terminal-dot" style={{ background: "#febc2e" }} />
        <span className="hero-terminal-dot" style={{ background: "#28c840" }} />
        <span className="ml-3 text-[10px] text-[var(--hero-text-muted)] hero-mono tracking-wider">
          achilles@command ~
        </span>
      </div>
      <div className="space-y-1">
        {lines.slice(0, visibleLines).map((line, i) => {
          if (line.type === "blank") return <div key={i} className="h-3" />;
          if (line.type === "comment")
            return (
              <p key={i} className="text-[var(--hero-text-muted)] opacity-50">
                {line.text}
              </p>
            );
          if (line.type === "command")
            return (
              <p key={i} className="text-[var(--hero-text-primary)] font-bold">
                {line.text}
              </p>
            );
          return (
            <p key={i} style={{ color: line.color }}>
              {line.text}
            </p>
          );
        })}
        {visibleLines < lines.length && (
          <span className="terminal-cursor" />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AI PIPELINE VISUALIZATION (interactive)
// ═══════════════════════════════════════════════════════════════

function AIPipeline({ lang, activeStep, onStepClick }: { lang: Lang; activeStep: number; onStepClick: (i: number) => void }) {
  const steps = [
    {
      icon: FileCode,
      label: tx({ en: "Threat Intel", es: "Intel de Amenazas" }, lang),
      detail: tx(
        { en: "APT reports, CVEs", es: "Reportes APT, CVEs" },
        lang,
      ),
    },
    {
      icon: Bot,
      label: tx({ en: "AI Analysis", es: "Análisis IA" }, lang),
      detail: tx(
        { en: "Extract TTPs", es: "Extraer TTPs" },
        lang,
      ),
    },
    {
      icon: Cpu,
      label: tx({ en: "Go Compile", es: "Compilar Go" }, lang),
      detail: tx(
        { en: "Cross-platform", es: "Multiplataforma" },
        lang,
      ),
    },
    {
      icon: Lock,
      label: tx({ en: "Sign & Ship", es: "Firmar y Enviar" }, lang),
      detail: tx(
        { en: "19 artifacts each", es: "19 artefactos c/u" },
        lang,
      ),
    },
  ];

  return (
    <div className="flex flex-col md:flex-row items-center gap-2 md:gap-0 justify-center">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-col md:flex-row items-center gap-2 md:gap-0">
          <button
            onClick={() => onStepClick(i)}
            className="pipeline-step flex items-center gap-3 min-w-[180px] cursor-pointer text-left"
            style={{
              borderColor: activeStep === i ? "var(--hero-accent-dim)" : undefined,
              boxShadow: activeStep === i ? "0 0 20px var(--hero-accent-subtle)" : undefined,
              background: activeStep === i ? "rgba(0, 230, 138, 0.06)" : undefined,
            }}
          >
            <step.icon
              className="w-5 h-5 flex-shrink-0"
              strokeWidth={1.5}
              style={{ color: activeStep === i ? "var(--hero-accent-bright)" : "var(--hero-accent)" }}
            />
            <div>
              <div className="text-xs font-bold text-[var(--hero-text-primary)] hero-heading uppercase tracking-wider">
                {step.label}
              </div>
              <div className="text-[10px] text-[var(--hero-text-muted)]">
                {step.detail}
              </div>
            </div>
          </button>
          {i < steps.length - 1 && (
            <div className="pipeline-connector hidden md:block" />
          )}
          {i < steps.length - 1 && (
            <div className="pipeline-connector block md:hidden" />
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════════════

function scrollTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function HeroNav({
  lang,
  onToggleLang,
}: {
  lang: Lang;
  onToggleLang: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navSections = [
    { id: "features", en: "Features", es: "Funciones" },
    { id: "platform", en: "Platform", es: "Plataforma" },
    { id: "how-it-works", en: "How It Works", es: "Cómo Funciona" },
    { id: "coverage", en: "Coverage", es: "Cobertura" },
  ] as const;

  return (
    <nav
      className="fixed w-full z-50 transition-all duration-500"
      style={{
        borderBottom: `1px solid ${scrolled ? "rgba(0, 230, 138, 0.1)" : "rgba(255,255,255,0.03)"}`,
        background: scrolled
          ? "rgba(5, 8, 16, 0.95)"
          : "rgba(5, 8, 16, 0.6)",
        backdropFilter: "blur(20px)",
        boxShadow: scrolled ? "0 4px 40px rgba(0,0,0,0.5)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          <svg className="h-12 w-12" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
            <path
              fill="#00e68a"
              fillRule="evenodd"
              d="M 250,28 L 480,458 L 20,458 Z M 250,252 L 312,458 L 230,458 L 150,360 L 195,310 L 155,250 Z"
            />
          </svg>
          <span
            className="text-2xl font-bold tracking-[0.2em] hero-heading"
            style={{ color: "var(--hero-text-primary)" }}
          >
            ACHILLES
          </span>
        </button>

        {/* Center links */}
        <div className="hidden lg:flex gap-1">
          {navSections.map(({ id, en, es }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="hero-nav-link"
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              {lang === "en" ? en : es}
            </button>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleLang}
            className="text-[10px] font-bold flex gap-1.5 border border-white/5 px-2.5 py-1.5 rounded hero-mono hover:border-[var(--hero-accent-dim)] transition-colors"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <span style={{ color: lang === "en" ? "var(--hero-accent)" : "var(--hero-text-muted)" }}>
              EN
            </span>
            <span className="text-white/10">|</span>
            <span style={{ color: lang === "es" ? "var(--hero-accent)" : "var(--hero-text-muted)" }}>
              ES
            </span>
          </button>

          <a
            href="https://docs.projectachilles.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-md border border-white/5 text-[var(--hero-text-muted)] hover:text-[var(--hero-accent)] hover:border-[var(--hero-accent-dim)] transition-all"
            title="Documentation"
          >
            <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
          </a>

          {isAppMode ? (
            <a
              href="/sign-in"
              className="hidden sm:flex items-center gap-2 rounded-md text-xs px-4 py-2 font-bold uppercase tracking-wider transition-all hero-heading"
              style={{ background: "var(--hero-accent)", color: "#050810" }}
            >
              <LogIn className="w-3.5 h-3.5" strokeWidth={2} />
              {tx({ en: "Sign In", es: "Entrar" }, lang)}
            </a>
          ) : (
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 rounded-md text-xs px-4 py-2 font-bold uppercase tracking-wider transition-all hero-heading hover:shadow-lg hover:shadow-[var(--hero-accent-subtle)]"
              style={{ background: "var(--hero-accent)", color: "#050810" }}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════
// HERO SECTION
// ═══════════════════════════════════════════════════════════════

function HeroSection({ lang }: { lang: Lang }) {
  const headline = tx(
    { en: "Achilles' Heel.", es: "Talón de Aquiles." },
    lang,
  );
  const { displayed, done } = useTypewriter(headline, 50, 1200);
  const scrollY = useParallax();

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 px-6 overflow-hidden">
      {/* Floating particles */}
      <FloatingParticles />

      {/* Parallax radial glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "50%",
          left: "50%",
          transform: `translate(-50%, calc(-50% + ${scrollY * 0.15}px))`,
          width: "900px",
          height: "900px",
          background:
            "radial-gradient(circle, rgba(0, 230, 138, 0.06) 0%, transparent 60%)",
        }}
      />

      <div className="max-w-7xl w-full z-10 flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
        {/* Left: Text content */}
        <div className="lg:w-1/2 text-center lg:text-left">
          {/* Status badge */}
          <div className="hero-reveal hero-reveal-delay-1 mb-8 flex justify-center lg:justify-start">
            <span className="hero-tag">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{
                  background: "var(--hero-accent)",
                  boxShadow: "0 0 8px var(--hero-accent-glow)",
                  animation: "hero-pulse 2s ease-in-out infinite",
                }}
              />
              {tx(
                {
                  en: "Open Source Security Platform",
                  es: "Plataforma de Seguridad Open Source",
                },
                lang,
              )}
            </span>
          </div>

          {/* Headline */}
          <h1 className="hero-heading hero-reveal hero-reveal-delay-2 text-4xl sm:text-5xl md:text-6xl xl:text-7xl font-bold mb-6 leading-[1.1]">
            <span className="block text-[var(--hero-text-secondary)]" style={{ fontSize: "0.65em", fontWeight: 500 }}>
              {tx(
                { en: "Every Organization Has an", es: "Toda organización tiene un" },
                lang,
              )}
            </span>
            <span
              className="hero-glitch hero-gradient-text block mt-2"
              data-text={headline}
              style={{ minHeight: "1.2em" }}
            >
              {displayed}
              {!done && (
                <span
                  className="inline-block w-[3px] ml-1"
                  style={{
                    height: "0.8em",
                    background: "var(--hero-accent)",
                    animation: "hero-cursor-blink 0.75s step-end infinite",
                    verticalAlign: "middle",
                  }}
                />
              )}
            </span>
          </h1>

          {/* Subheading */}
          <p className="hero-reveal hero-reveal-delay-3 text-base md:text-lg max-w-xl mx-auto lg:mx-0 mb-10 leading-relaxed text-[var(--hero-text-muted)]">
            {tx(
              {
                en: "Continuous security validation that turns threat intelligence into executable tests, deploys them across your fleet, and measures whether your defenses actually work. Evidence, not opinions.",
                es: "Validación continua de seguridad que convierte inteligencia de amenazas en tests ejecutables, los despliega en tu flota y mide si tus defensas realmente funcionan. Evidencia, no opiniones.",
              },
              lang,
            )}
          </p>

          {/* CTAs */}
          <div className="hero-reveal hero-reveal-delay-4 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            {isAppMode ? (
              <>
                <a href="/sign-up">
                  <button className="hero-btn-primary w-full sm:w-auto">
                    {tx({ en: "Get Started", es: "Comenzar" }, lang)}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </a>
                <a href="/sign-in">
                  <button className="hero-btn-secondary w-full sm:w-auto">
                    {tx({ en: "Sign In", es: "Iniciar Sesión" }, lang)}
                  </button>
                </a>
              </>
            ) : (
              <>
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                  <button className="hero-btn-primary w-full sm:w-auto">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.579.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.3 14.3 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.36 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Z" />
                    </svg>
                    {tx({ en: "Join the Community", es: "Únete" }, lang)}
                  </button>
                </a>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <button className="hero-btn-secondary w-full sm:w-auto">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    {tx({ en: "View on GitHub", es: "Ver en GitHub" }, lang)}
                  </button>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Right: Cyber Visualization */}
        <div
          className="lg:w-1/2 hero-reveal-scale hero-reveal-delay-3 flex justify-center"
          style={{ transform: `translateY(${scrollY * -0.08}px)` }}
        >
          <CyberVisualization />
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hero-reveal hero-reveal-delay-7 flex flex-col items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.3em] text-[var(--hero-text-muted)] hero-mono">
          {tx({ en: "Scroll to explore", es: "Desplaza para explorar" }, lang)}
        </span>
        <ChevronDown
          className="w-4 h-4 text-[var(--hero-accent)]"
          style={{ animation: "hero-reveal-up 1.5s ease-in-out infinite" }}
        />
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════════════

function StatsBar({ lang }: { lang: Lang }) {
  const c1 = useAnimatedCounter(500, 2000, 0);
  const c2 = useAnimatedCounter(19, 1500, 200);
  const c3 = useAnimatedCounter(6, 1200, 400);
  const c4 = useAnimatedCounter(30, 1800, 300);

  const stats = [
    { ref: c1.ref, value: `${c1.value}+`, label: tx({ en: "Security Tests", es: "Tests de Seguridad" }, lang) },
    { ref: c2.ref, value: String(c2.value), label: tx({ en: "Artifacts Per Test", es: "Artefactos por Test" }, lang) },
    { ref: c3.ref, value: String(c3.value), label: tx({ en: "Target Platforms", es: "Plataformas" }, lang) },
    { ref: c4.ref, value: `${c4.value}+`, label: tx({ en: "Analytics Queries", es: "Consultas Analíticas" }, lang) },
  ];

  return (
    <div className="reveal-section border-y border-white/[0.03]" style={{ background: "rgba(5, 8, 16, 0.8)" }}>
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {stats.map((s, i) => (
          <div key={i} className="hero-stat">
            <div className="hero-stat-value" ref={s.ref}>
              {s.value}
            </div>
            <div className="hero-stat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEATURES SECTION
// ═══════════════════════════════════════════════════════════════

const features = [
  {
    icon: Sparkles,
    title: { en: "AI-Powered Test Development", es: "Desarrollo de Tests con IA" },
    desc: {
      en: "Multi-agent AI pipeline transforms threat reports into complete, deployable security test packages — source code, detection rules, hardening scripts, and documentation.",
      es: "Pipeline multi-agente de IA transforma reportes de amenazas en paquetes de tests completos y desplegables: código fuente, reglas de detección, scripts de hardening y documentación.",
    },
    accent: true,
  },
  {
    icon: Server,
    title: { en: "Go Agent Framework", es: "Framework de Agentes Go" },
    desc: {
      en: "Lightweight Go binary deployed to Windows, Linux, and macOS. Token-based enrollment, heartbeat monitoring, secure execution with Ed25519 signatures, and self-updating.",
      es: "Binario Go ligero desplegado en Windows, Linux y macOS. Enrollment basado en tokens, monitoreo de heartbeat, ejecución segura con firmas Ed25519 y auto-actualización.",
    },
    accent: false,
  },
  {
    icon: BarChart3,
    title: { en: "Defense Score Analytics", es: "Analíticas de Defense Score" },
    desc: {
      en: "30+ Elasticsearch query endpoints. Defense scores, MITRE ATT&CK heatmaps, coverage treemaps, trend analysis, and host-test matrices. Evidence-based risk quantification.",
      es: "Más de 30 endpoints de consulta Elasticsearch. Defense scores, heatmaps MITRE ATT&CK, treemaps de cobertura, análisis de tendencias y matrices host-test.",
    },
    accent: true,
  },
  {
    icon: Terminal,
    title: { en: "CLI & AI Chat Agent", es: "CLI y Agente IA de Chat" },
    desc: {
      en: "Bun-powered CLI with 17+ command modules. AI conversational agent mode powered by Vercel AI SDK for natural-language fleet operations. --json flag on every command.",
      es: "CLI potenciado con Bun y 17+ módulos de comandos. Modo agente conversacional IA impulsado por Vercel AI SDK para operaciones de flota en lenguaje natural.",
    },
    accent: false,
  },
  {
    icon: Shield,
    title: { en: "Microsoft Defender Integration", es: "Integración con Microsoft Defender" },
    desc: {
      en: "Sync Secure Score, alerts, and control profiles from Microsoft Graph API. Cross-correlation analytics between your validation results and EDR posture data.",
      es: "Sincroniza Secure Score, alertas y perfiles de control desde Microsoft Graph API. Analíticas de correlación cruzada entre resultados de validación y datos de postura EDR.",
    },
    accent: false,
  },
  {
    icon: Layers,
    title: { en: "Build System & Code Signing", es: "Sistema de Build y Firma de Código" },
    desc: {
      en: "Go cross-compilation for 6 platform targets. Windows Authenticode and macOS ad-hoc signing. Multi-certificate management with up to 5 certificates.",
      es: "Compilación cruzada Go para 6 plataformas. Firma Windows Authenticode y macOS ad-hoc. Gestión multi-certificado con hasta 5 certificados.",
    },
    accent: true,
  },
];

function FeaturesSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="features"
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-20">
          <span className="hero-tag mb-6 inline-flex">
            {tx({ en: "Core Capabilities", es: "Capacidades Principales" }, lang)}
          </span>
          <h2 className="hero-heading text-3xl md:text-4xl font-bold mt-6 mb-4">
            {tx(
              {
                en: "Everything You Need to Validate Defenses",
                es: "Todo lo que Necesitas para Validar Defensas",
              },
              lang,
            )}
          </h2>
          <p className="text-[var(--hero-text-muted)] max-w-2xl mx-auto">
            {tx(
              {
                en: "Four integrated modules that close the loop from threat intelligence to defense measurement.",
                es: "Cuatro módulos integrados que cierran el ciclo desde inteligencia de amenazas hasta medición de defensas.",
              },
              lang,
            )}
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, desc, accent }, i) => (
            <div
              key={i}
              className="hero-card reveal-child group"
            >
              <div
                className="hero-card-icon"
                style={
                  accent
                    ? {}
                    : {
                        background: "rgba(255,255,255,0.04)",
                        borderColor: "rgba(255,255,255,0.08)",
                        color: "var(--hero-text-secondary)",
                      }
                }
              >
                <Icon className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <h3 className="hero-heading text-base font-bold mb-3 tracking-wide">
                {tx(title, lang)}
              </h3>
              <p className="text-sm text-[var(--hero-text-muted)] leading-relaxed">
                {tx(desc, lang)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM IN ACTION (Screenshots)
// ═══════════════════════════════════════════════════════════════

const platformSlides = [
  {
    src: "assets/images/Scoring.webp",
    label: { en: "Analytics Dashboard", es: "Panel de Analíticas" },
    title: { en: "Real-Time Defense Scoring", es: "Puntuación de Defensa en Tiempo Real" },
    desc: {
      en: "Track your Defense Score and Secure Score over time. Visualize trend data, identify detection gaps, and correlate findings with your SIEM and EDR telemetry.",
      es: "Rastrea tu Defense Score y Secure Score a lo largo del tiempo. Visualiza tendencias, identifica brechas de detección y correlaciona hallazgos con tu SIEM y EDR.",
    },
  },
  {
    src: "assets/images/Library.webp",
    label: { en: "Test Library", es: "Librería de Tests" },
    title: { en: "MITRE ATT&CK Test Library", es: "Librería de Tests MITRE ATT&CK" },
    desc: {
      en: "Browse 500+ security tests mapped to MITRE ATT&CK. Filter by severity, tactic, or category. Build, sign, and download test binaries directly from the browser.",
      es: "Explora más de 500 tests de seguridad mapeados a MITRE ATT&CK. Filtra por severidad, táctica o categoría. Compila, firma y descarga binarios de test.",
    },
  },
  {
    src: "assets/images/Endpoint.webp",
    label: { en: "Fleet Management", es: "Gestión de Flota" },
    title: { en: "Fleet-Wide Endpoint Management", es: "Gestión de Endpoints a Escala de Flota" },
    desc: {
      en: "Monitor your entire agent fleet in one view. Track uptime, task success rates, and health across all enrolled endpoints with stale agent detection.",
      es: "Monitorea toda tu flota de agentes en una vista. Rastrea uptime, tasas de éxito y salud en todos los endpoints enrollados.",
    },
  },
];

function PlatformSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="platform"
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-surface)" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <span className="hero-tag mb-6 inline-flex">
            {tx({ en: "Platform", es: "Plataforma" }, lang)}
          </span>
          <h2 className="hero-heading text-3xl md:text-4xl font-bold mt-6">
            {tx({ en: "See It in Action", es: "Velo en Acción" }, lang)}
          </h2>
        </div>

        <div className="flex flex-col gap-32">
          {platformSlides.map((slide, i) => {
            const imageLeft = i % 2 === 0;

            const imageBlock = (
              <div className="lg:w-3/5 w-full">
                <div className="hero-screenshot">
                  <img
                    src={slide.src}
                    alt={tx(slide.title, lang)}
                    className="w-full h-auto"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
              </div>
            );

            const textBlock = (
              <div className="lg:w-2/5 w-full flex flex-col justify-center gap-5">
                <span className="hero-tag self-start">
                  {tx(slide.label, lang)}
                </span>
                <h3 className="hero-heading text-2xl md:text-3xl font-bold leading-snug">
                  {tx(slide.title, lang)}
                </h3>
                <p className="text-[var(--hero-text-muted)] leading-relaxed">
                  {tx(slide.desc, lang)}
                </p>
                <span className="hero-mono text-[10px] tracking-widest text-[var(--hero-accent)] opacity-40">
                  0{i + 1} / 0{platformSlides.length}
                </span>
              </div>
            );

            return (
              <div key={i} className="flex flex-col lg:flex-row gap-12 items-center reveal-child">
                {imageLeft ? imageBlock : textBlock}
                {imageLeft ? textBlock : imageBlock}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOW IT WORKS (Pipeline + Terminal)
// ═══════════════════════════════════════════════════════════════

function HowItWorksSection({ lang }: { lang: Lang }) {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section
      id="how-it-works"
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <span className="hero-tag mb-6 inline-flex">
            {tx({ en: "How It Works", es: "Cómo Funciona" }, lang)}
          </span>
          <h2 className="hero-heading text-3xl md:text-4xl font-bold mt-6 mb-4">
            {tx(
              {
                en: "From Threat Intel to Defense Score",
                es: "De Intel de Amenazas a Defense Score",
              },
              lang,
            )}
          </h2>
          <p className="text-[var(--hero-text-muted)] max-w-2xl mx-auto">
            {tx(
              {
                en: "Click each pipeline step to see its terminal output. Each test package includes 19 artifacts.",
                es: "Haz clic en cada paso del pipeline para ver su salida en terminal. Cada paquete incluye 19 artefactos.",
              },
              lang,
            )}
          </p>
        </div>

        {/* Interactive pipeline */}
        <div className="mb-20 reveal-child">
          <AIPipeline lang={lang} activeStep={activeStep} onStepClick={setActiveStep} />
        </div>

        {/* Two-column: Terminal + Artifacts */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <div className="reveal-child">
            <PipelineTerminal activeStep={activeStep} />
          </div>

          <div className="reveal-child space-y-4">
            <h3 className="hero-heading text-xl font-bold mb-6">
              {tx({ en: "What Each Test Includes", es: "Qué Incluye Cada Test" }, lang)}
            </h3>

            {[
              {
                icon: Cpu,
                title: tx({ en: "Test Binary", es: "Binario de Test" }, lang),
                desc: tx({ en: "Go binary for Windows, Linux, macOS", es: "Binario Go para Windows, Linux, macOS" }, lang),
              },
              {
                icon: Eye,
                title: tx({ en: "Detection Rules", es: "Reglas de Detección" }, lang),
                desc: tx({ en: "KQL, YARA, Sigma, Elastic EQL, LimaCharlie", es: "KQL, YARA, Sigma, Elastic EQL, LimaCharlie" }, lang),
              },
              {
                icon: Lock,
                title: tx({ en: "Hardening Scripts", es: "Scripts de Hardening" }, lang),
                desc: tx({ en: "PowerShell + Bash remediation", es: "Remediación PowerShell + Bash" }, lang),
              },
              {
                icon: GitBranch,
                title: tx({ en: "Kill Chain Diagram", es: "Diagrama Kill Chain" }, lang),
                desc: tx({ en: "Interactive HTML attack flow", es: "Flujo de ataque HTML interactivo" }, lang),
              },
              {
                icon: Target,
                title: tx({ en: "MITRE Mapping", es: "Mapeo MITRE" }, lang),
                desc: tx({ en: "Technique, tactic, severity, threat actor", es: "Técnica, táctica, severidad, actor de amenaza" }, lang),
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-4 p-4 rounded-lg transition-all hover:bg-white/[0.02]"
                style={{ border: "1px solid rgba(255,255,255,0.03)" }}
              >
                <div
                  className="p-2 rounded-lg flex-shrink-0"
                  style={{
                    background: "rgba(0, 230, 138, 0.08)",
                    border: "1px solid rgba(0, 230, 138, 0.15)",
                  }}
                >
                  <item.icon className="w-4 h-4 text-[var(--hero-accent)]" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--hero-text-primary)] hero-heading tracking-wide">
                    {item.title}
                  </div>
                  <div className="text-xs text-[var(--hero-text-muted)]">
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// MITRE COVERAGE SECTION
// ═══════════════════════════════════════════════════════════════

function CoverageSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="coverage"
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-surface)" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <span className="hero-tag mb-6 inline-flex">
            {tx({ en: "Coverage Matrix", es: "Matriz de Cobertura" }, lang)}
          </span>
          <h2 className="hero-heading text-3xl md:text-4xl font-bold mt-6 mb-4">
            {tx(
              {
                en: "Know Your MITRE ATT&CK Coverage",
                es: "Conoce tu Cobertura MITRE ATT&CK",
              },
              lang,
            )}
          </h2>
          <p className="text-[var(--hero-text-muted)] max-w-2xl mx-auto">
            {tx(
              {
                en: "Every test maps to MITRE ATT&CK techniques. See exactly which tactics you're defended against, where you have partial coverage, and where the gaps are.",
                es: "Cada test se mapea a técnicas MITRE ATT&CK. Ve exactamente contra que tácticas estás defendido, donde tienes cobertura parcial y donde están las brechas.",
              },
              lang,
            )}
          </p>
        </div>

        <div
          className="p-8 rounded-2xl reveal-child"
          style={{
            background: "var(--hero-bg-elevated)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <MitreGrid />
        </div>

        {/* Three modes */}
        <div className="grid md:grid-cols-3 gap-6 mt-16">
          {[
            {
              icon: Target,
              title: tx({ en: "Intel-Driven", es: "Basado en Intel" }, lang),
              desc: tx(
                {
                  en: "Real-world APT techniques from threat reports. Lazarus, Emotet, and more.",
                  es: "Técnicas APT reales de reportes de amenazas. Lazarus, Emotet y mas.",
                },
                lang,
              ),
            },
            {
              icon: Bug,
              title: tx({ en: "MITRE Top 10", es: "MITRE Top 10" }, lang),
              desc: tx(
                {
                  en: "Most common ransomware techniques. Process injection, defense evasion, lateral movement.",
                  es: "Técnicas de ransomware más comunes. Inyección de procesos, evasión de defensas, movimiento lateral.",
                },
                lang,
              ),
            },
            {
              icon: Gauge,
              title: tx({ en: "Cyber Hygiene", es: "Ciber Higiene" }, lang),
              desc: tx(
                {
                  en: "Configuration validation for Defender settings, ASR rules, LSASS protection, MFA.",
                  es: "Validación de configuración para Defender, reglas ASR, protección LSASS, MFA.",
                },
                lang,
              ),
            },
          ].map((item, i) => (
            <div key={i} className="hero-card reveal-child">
              <item.icon
                className="w-6 h-6 text-[var(--hero-accent)] mb-4"
                strokeWidth={1.5}
              />
              <h3 className="hero-heading text-sm font-bold mb-2 tracking-wider uppercase">
                {item.title}
              </h3>
              <p className="text-xs text-[var(--hero-text-muted)] leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROBLEM SECTION
// ═══════════════════════════════════════════════════════════════

const problemItems = [
  {
    Icon: Clock,
    title: { en: "Point-in-Time Testing", es: "Tests Puntuales" },
    desc: {
      en: "Annual pentests are obsolete minutes after completion. Threats don't wait for your audit cycle.",
      es: "Los pentests anuales quedan obsoletos minutos después de finalizar.",
    },
  },
  {
    Icon: ShieldAlert,
    title: { en: "Compliance != Resilience", es: "Cumplimiento != Resiliencia" },
    desc: {
      en: "Checking boxes provides legal cover but zero evidence of actual detection efficacy.",
      es: "Marcar casillas ofrece seguridad legal pero cero evidencia de eficacia de detección.",
    },
  },
  {
    Icon: BarChart3,
    title: { en: "Unmeasurable ROI", es: "ROI Inconmensurable" },
    desc: {
      en: "CISOs can't quantify the risk reduction of their multi-million dollar security stack.",
      es: "Los CISOs no pueden cuantificar la reducción de riesgo de su inversión en seguridad.",
    },
  },
  {
    Icon: EyeOff,
    title: { en: "Blind Coverage", es: "Cobertura Ciega" },
    desc: {
      en: "Unknown gaps in detection allow adversaries to remain persistent for months undetected.",
      es: "Brechas desconocidas permiten que los adversarios permanezcan meses sin ser detectados.",
    },
  },
];

function ProblemSection({ lang }: { lang: Lang }) {
  return (
    <section
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          <div className="lg:w-2/5">
            <span className="hero-tag mb-6 inline-flex">
              {tx({ en: "The Problem", es: "El Problema" }, lang)}
            </span>
            <h2 className="hero-heading text-3xl md:text-4xl font-bold mt-6 mb-4 leading-tight">
              {tx(
                {
                  en: "Security Tools Without Proof They Work",
                  es: "Herramientas de Seguridad Sin Prueba de que Funcionan",
                },
                lang,
              )}
            </h2>
            <p className="text-[var(--hero-text-muted)] leading-relaxed">
              {tx(
                {
                  en: "Most organizations invest heavily in EDR, SIEM, and endpoint hardening. Then hope for the best. When a breach happens, the post-mortem reveals gaps that were always there but never measured.",
                  es: "La mayoría de las organizaciones invierten mucho en EDR, SIEM y hardening. Luego esperan lo mejor. Cuando ocurre una brecha, el post-mortem revela brechas que siempre estuvieron ahí pero nunca se midieron.",
                },
                lang,
              )}
            </p>
          </div>

          <div className="lg:w-3/5 grid sm:grid-cols-2 gap-5">
            {problemItems.map(({ Icon, title, desc }, i) => (
              <div
                key={i}
                className="reveal-child p-6 rounded-xl transition-all hover:bg-white/[0.02]"
                style={{
                  border: "1px solid rgba(255,255,255,0.04)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <Icon className="w-5 h-5 text-[var(--hero-danger)] mb-4 opacity-70" strokeWidth={1.5} />
                <h3 className="hero-heading text-sm font-bold mb-2 tracking-wide">
                  {tx(title, lang)}
                </h3>
                <p className="text-xs text-[var(--hero-text-muted)] leading-relaxed">
                  {tx(desc, lang)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECURITY SECTION
// ═══════════════════════════════════════════════════════════════

function SecuritySection({ lang }: { lang: Lang }) {
  const securityFeatures = [
    { icon: Lock, label: tx({ en: "AES-256-GCM Encrypted Config", es: "Config Encriptada AES-256-GCM" }, lang) },
    { icon: Shield, label: tx({ en: "Ed25519 Binary Signatures", es: "Firmas Ed25519 de Binarios" }, lang) },
    { icon: Clock, label: tx({ en: "Replay Protection (5-min Skew)", es: "Protección de Replay (5-min)" }, lang) },
    { icon: Zap, label: tx({ en: "Zero-Downtime Key Rotation", es: "Rotación de Claves Sin Downtime" }, lang) },
    { icon: Network, label: tx({ en: "TLS Enforcement", es: "Aplicación de TLS" }, lang) },
    { icon: Activity, label: tx({ en: "Rate Limiting Per Endpoint", es: "Rate Limiting por Endpoint" }, lang) },
  ];

  return (
    <section
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-5xl mx-auto">
        <div
          className="p-10 md:p-14 rounded-2xl relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, var(--hero-bg-elevated) 0%, var(--hero-bg-surface) 100%)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {/* Top accent line */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, var(--hero-accent-dim), transparent)" }}
          />

          <div className="text-center mb-12">
            <span className="hero-tag mb-6 inline-flex">
              {tx({ en: "Security Hardened", es: "Seguridad Reforzada" }, lang)}
            </span>
            <h2 className="hero-heading text-2xl md:text-3xl font-bold mt-6">
              {tx(
                {
                  en: "Built-In Agent Communication Security",
                  es: "Seguridad de Comunicación de Agentes Integrada",
                },
                lang,
              )}
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {securityFeatures.map((f, i) => (
              <div
                key={i}
                className="reveal-child flex items-center gap-3 p-4 rounded-lg"
                style={{
                  background: "rgba(0, 230, 138, 0.03)",
                  border: "1px solid rgba(0, 230, 138, 0.08)",
                }}
              >
                <f.icon className="w-4 h-4 text-[var(--hero-accent)] flex-shrink-0" strokeWidth={1.5} />
                <span className="text-xs text-[var(--hero-text-secondary)] font-medium">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// AI FACTOR SECTION
// ═══════════════════════════════════════════════════════════════

function AIFactorSection({ lang }: { lang: Lang }) {
  return (
    <section
      className="reveal-section py-28 px-6"
      style={{ background: "var(--hero-bg-surface)" }}
    >
      <div className="max-w-4xl mx-auto text-center">
        <Sparkles className="w-8 h-8 text-[var(--hero-accent)] mx-auto mb-6" strokeWidth={1.5} />
        <h2 className="hero-heading text-2xl md:text-3xl font-bold mb-6">
          {tx(
            {
              en: "The AI Factor: Agentic Development",
              es: "El Factor IA: Desarrollo Agéntico",
            },
            lang,
          )}
        </h2>
        <p className="text-[var(--hero-text-muted)] leading-relaxed mb-6 max-w-2xl mx-auto">
          {tx(
            {
              en: "ProjectAchilles wouldn't exist without LLM-assisted development. AI accelerated our tool development by 4x, allowing us to focus on complex logic while LLMs handled boilerplate and cross-platform compatibility.",
              es: "ProjectAchilles no existiría sin desarrollo asistido por LLM. La IA aceleró nuestro desarrollo de herramientas 4x, permitiéndonos enfocarnos en lógica compleja.",
            },
            lang,
          )}
        </p>
        <p className="text-sm text-[var(--hero-accent)] opacity-70 hero-mono">
          {tx(
            {
              en: "Offensive and defensive tools, built at the speed of thought.",
              es: "Herramientas ofensivas y defensivas, construidas a la velocidad del pensamiento.",
            },
            lang,
          )}
        </p>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEPLOYMENT SECTION
// ═══════════════════════════════════════════════════════════════

function DeploymentSection({ lang }: { lang: Lang }) {
  const targets = [
    { name: "Docker Compose", desc: tx({ en: "SQLite + Volume", es: "SQLite + Volumen" }, lang), primary: true },
    { name: "Fly.io", desc: tx({ en: "~$8/mo always-on", es: "~$8/mes siempre activo" }, lang), primary: false },
    { name: "Railway", desc: tx({ en: "One-click deploy", es: "Deploy en un click" }, lang), primary: false },
    { name: "Render", desc: tx({ en: "Persistent disk", es: "Disco persistente" }, lang), primary: false },
    { name: "Vercel", desc: tx({ en: "Serverless + Turso", es: "Serverless + Turso" }, lang), primary: false },
  ];

  return (
    <section
      className="reveal-section py-20 px-6"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-5xl mx-auto text-center">
        <h2 className="hero-heading text-xl md:text-2xl font-bold mb-10">
          {tx(
            { en: "Deploy Anywhere in Minutes", es: "Despliega en Cualquier Lugar en Minutos" },
            lang,
          )}
        </h2>

        <div className="flex flex-wrap gap-3 justify-center">
          {targets.map((t, i) => (
            <div
              key={i}
              className="reveal-child px-5 py-3 rounded-lg flex items-center gap-3 transition-all hover:border-[var(--hero-accent-dim)]"
              style={{
                background: t.primary ? "rgba(0, 230, 138, 0.05)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${t.primary ? "rgba(0, 230, 138, 0.15)" : "rgba(255,255,255,0.04)"}`,
              }}
            >
              <span className="text-sm font-bold text-[var(--hero-text-primary)] hero-heading">
                {t.name}
              </span>
              <span className="text-[10px] text-[var(--hero-text-muted)] hero-mono">
                {t.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════════════

function HeroFooter({ lang }: { lang: Lang }) {
  return (
    <footer
      className="py-24 px-6"
      style={{
        background: "var(--hero-bg-deep)",
        borderTop: "1px solid rgba(255,255,255,0.03)",
      }}
    >
      <div className="max-w-7xl mx-auto">
        {/* CTA */}
        <div className="text-center mb-20">
          <h2 className="hero-heading text-3xl md:text-4xl font-bold mb-6">
            {tx(
              {
                en: "Ready to Measure Your Defenses?",
                es: "Listo para Medir tus Defensas?",
              },
              lang,
            )}
          </h2>
          <p className="text-[var(--hero-text-muted)] mb-10 max-w-lg mx-auto">
            {tx(
              {
                en: "The repository is live. Open source, Apache 2.0 licensed. Deploy in minutes.",
                es: "El repositorio está activo. Open source, licencia Apache 2.0. Despliega en minutos.",
              },
              lang,
            )}
          </p>
          <div className="flex gap-4 justify-center flex-col sm:flex-row">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <button className="hero-btn-primary w-full sm:w-auto">
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                {tx({ en: "Star on GitHub", es: "Estrella en GitHub" }, lang)}
              </button>
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              <button className="hero-btn-secondary w-full sm:w-auto">
                {tx({ en: "Join Discord", es: "Únete a Discord" }, lang)}
              </button>
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="hero-divider mb-10" />

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 text-[10px] uppercase tracking-[0.3em] text-[var(--hero-text-muted)] hero-mono">
          <p>&copy; {new Date().getFullYear()} Project Achilles. Apache 2.0</p>
          <p>
            {tx(
              {
                en: "Stop hoping your defenses work. Start proving it.",
                es: "Deja de esperar que tus defensas funcionen. Empieza a demostrarlo.",
              },
              lang,
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN HERO PAGE
// ═══════════════════════════════════════════════════════════════

export default function HeroPage() {
  const [lang, setLang] = useState<Lang>("en");
  useScrollReveal();

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        background: "var(--hero-bg-deep)",
        color: "var(--hero-text-primary)",
      }}
    >
      {/* Animated grid background */}
      <div className="hero-grid-bg">
        <div className="hero-grid-pulse" />
      </div>

      {/* Noise texture */}
      <div className="hero-noise" />

      {/* Content */}
      <div className="relative z-10">
        <HeroNav
          lang={lang}
          onToggleLang={() => setLang((l) => (l === "en" ? "es" : "en"))}
        />
        <HeroSection lang={lang} />
        <StatsBar lang={lang} />
        <ProblemSection lang={lang} />
        <FeaturesSection lang={lang} />
        <PlatformSection lang={lang} />
        <HowItWorksSection lang={lang} />
        <CoverageSection lang={lang} />
        <SecuritySection lang={lang} />
        <DeploymentSection lang={lang} />
        <AIFactorSection lang={lang} />
        <HeroFooter lang={lang} />
      </div>
    </div>
  );
}
