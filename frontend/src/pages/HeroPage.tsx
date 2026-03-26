import { useState, useEffect } from "react";
import {
  Clock,
  ShieldAlert,
  BarChart3,
  EyeOff,
  Binary,
  Activity,
  Cpu,
  Sparkles,
  BookOpen,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// TYPES & CONTENT
// ═══════════════════════════════════════════════════════════════

type Lang = "en" | "es";

const GITHUB_URL = "https://github.com/projectachilles/ProjectAchilles";
const DISCORD_URL = "https://discord.gg/4qzwX9XA";

function tx(obj: { en: string; es: string }, lang: Lang) {
  return obj[lang];
}

const problemItems = [
  {
    Icon: Clock,
    title: { en: "Point-in-Time Failures", es: "Fallos de Punto en el Tiempo" },
    desc: {
      en: "Annual penetration tests are obsolete minutes after completion. Real threats don't wait for your audit cycle.",
      es: "Las pruebas de penetración anuales quedan obsoletas minutos después de finalizar. Las amenazas reales no esperan a su ciclo de auditoría.",
    },
  },
  {
    Icon: ShieldAlert,
    title: { en: "Compliance ≠ Resilience", es: "Cumplimiento ≠ Resiliencia" },
    desc: {
      en: "Checking a box provides legal safety, but provides zero evidence of actual detection efficacy against TTPs.",
      es: "Marcar una casilla ofrece seguridad legal, pero no proporciona evidencia de la eficacia de detección real contra TTPs.",
    },
  },
  {
    Icon: BarChart3,
    title: { en: "Unmeasurable ROI", es: "ROI Inconmensurable" },
    desc: {
      en: "Security leaders struggle to justify budget because they cannot quantify the risk reduction of their current stack.",
      es: "Los líderes de seguridad luchan por justificar el presupuesto porque no pueden cuantificar la reducción del riesgo de su infraestructura actual.",
    },
  },
  {
    Icon: EyeOff,
    title: { en: "Blind Coverage", es: "Cobertura Ciega" },
    desc: {
      en: "Unknown gaps in detection allow adversaries to remain persistent for months without being flagged.",
      es: "Brechas desconocidas en la detección permiten que los adversarios permanezcan persistentes durante meses sin ser detectados.",
    },
  },
];

const solutionItems = [
  {
    Icon: Binary,
    accent: true,
    title: { en: "Adversary Emulation", es: "Emulación de Adversarios" },
    desc: {
      en: "Automated execution of MITRE ATT&CK techniques across all endpoints.",
      es: "Ejecución automatizada de técnicas MITRE ATT&CK en todos los endpoints.",
    },
  },
  {
    Icon: Activity,
    accent: true,
    title: {
      en: "Real-time Detection Mapping",
      es: "Mapeo de Detección en Tiempo Real",
    },
    desc: {
      en: "Bridges the gap between offensive testing and SIEM/EDR telemetry.",
      es: "Cierra la brecha entre las pruebas ofensivas y la telemetría SIEM/EDR.",
    },
  },
  {
    Icon: Cpu,
    accent: false,
    title: { en: "Evidence-Based Risk", es: "Riesgo Basado en Evidencia" },
    desc: {
      en: "Stop guessing. Quantify your cyber risk using hard technical evidence.",
      es: "Deje de adivinar. Cuantifique su riesgo cibernético utilizando evidencia técnica sólida.",
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// TYPEWRITER HOOK
// ═══════════════════════════════════════════════════════════════

function useTypewriter(text: string, speed = 55, startDelay = 600) {
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

// ═══════════════════════════════════════════════════════════════
// SCROLL REVEAL HOOK
// ═══════════════════════════════════════════════════════════════

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
      { threshold: 0.1 },
    );

    document
      .querySelectorAll(".reveal-section")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
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

  return (
    <nav
      className="fixed w-full z-50 border-b backdrop-blur-md transition-all duration-500"
      style={{
        borderColor: scrolled
          ? "rgba(6, 149, 107, 0.15)"
          : "var(--hero-grid-line)",
        background: scrolled
          ? "rgba(10, 14, 26, 0.97)"
          : "rgba(10, 14, 26, 0.75)",
        boxShadow: scrolled ? "0 4px 30px rgba(0,0,0,0.4)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="text-xl font-bold tracking-widest hero-heading hover:text-[var(--hero-accent)] w-auto flex transition-colors items-center gap-1"
          style={{
            letterSpacing: "0.15em",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          <svg
          className="h-10 w-10"
            viewBox="0 0 500 500"
            xmlns="http://www.w3.org/2000/svg"
            style={{ background: "#111111;" }}
          >
            <path
              fill="#06956b"
              fill-rule="evenodd"
              d="
    M 250,28
    L 480,458
    L 20,458
    Z
 
    M 250,252
    L 312,458
    L 230,458
    L 150,360
    L 195,310
    L 155,250
    Z
  "
            />
          </svg>
          <span
            className="text-2xl font-bold tracking-widest logo-font"
            style={{ letterSpacing: "0.15em;" }}
          >
            ACHILLES
          </span>
        </button>

        {/* Center links */}
        <div className="hidden md:flex gap-8 text-xs font-medium text-[var(--hero-text-muted)] uppercase tracking-widest hero-mono">
          {(
            [
              { id: "problem", en: "The Problem", es: "El Problema" },
              { id: "solution", en: "The Solution", es: "La Solución" },
              { id: "metrics", en: "ROI & Risk", es: "ROI y Riesgo" },
            ] as const
          ).map(({ id, en, es }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="hover:text-[var(--hero-accent)] transition-colors"
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              {lang === "en" ? en : es}
            </button>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Language toggle */}
          <button
            onClick={onToggleLang}
            className="text-[10px] font-bold flex gap-2 border border-[var(--hero-grid-line)] px-3 py-1 mr-2 rounded hero-mono hover:border-[var(--hero-accent)] transition-colors"
          >
            <span
              style={{
                color:
                  lang === "en"
                    ? "var(--hero-accent)"
                    : "var(--hero-text-muted)",
                fontWeight: lang === "en" ? "bold" : "normal",
              }}
            >
              EN
            </span>
            <span className="text-white/20">|</span>
            <span
              style={{
                color:
                  lang === "es"
                    ? "var(--hero-accent)"
                    : "var(--hero-text-muted)",
                fontWeight: lang === "es" ? "bold" : "normal",
              }}
            >
              ES
            </span>
          </button>

          {/* Docs button — icon only */}
          <a
            href="https://docs.projectachilles.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center justify-center w-8 h-8 transition-all duration-300 text-[var(--hero-text-muted)] hover:text-[var(--hero-accent)]"
            style={{
              border: "1px solid var(--hero-grid-line)",
              borderRadius: "4px",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = "var(--hero-accent)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = "var(--hero-grid-line)")
            }
            title="Documentation"
          >
            <BookOpen className="w-4 h-4" strokeWidth={1.5} />
          </a>

          {/* GitHub button */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:block rounded text-xs px-4 py-2 font-bold uppercase transition-all hero-heading text-sm"
            style={{ background: "var(--hero-accent)", color: "#0A0E1A" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════
// HERO SECTION
// ═══════════════════════════════════════════════════════════════

function HeroSection({ lang }: { lang: Lang }) {
  const headline2 = tx(
    { en: "Achilles' Heel.", es: "Talón de Aquiles." },
    lang,
  );
  const { displayed, done } = useTypewriter(headline2, 55, 1000);

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 px-6">
      {/* Radial glow */}
      <div
        className="absolute top-1/2 left-1/2 pointer-events-none"
        style={{
          transform: "translate(-50%, -50%)",
          width: "600px",
          height: "600px",
          background:
            "radial-gradient(circle, rgba(6, 149, 107, 0.08) 0%, rgba(10, 14, 26, 0) 70%)",
          zIndex: 0,
        }}
      />

      <div className="max-w-5xl w-full text-center z-10">
        {/* Headline */}
        <h1 className="hero-heading hero-reveal hero-reveal-delay-1 text-4xl md:text-7xl font-bold mb-8 leading-tight tracking-tight">
          <span className="hero-glow-text">
            {tx(
              {
                en: "Every Organization Has an",
                es: "Toda organización tiene un",
              },
              lang,
            )}
          </span>
          <br />
          <span className="hero-gradient-text h-[90px]">
            {displayed}
            {!done && (
              <span
                className="inline-block w-[3px] ml-1 align-middle"
                style={{
                  height: "0.85em",
                  background: "var(--hero-accent)",
                  animation: "hero-cursor-blink 0.75s step-end infinite",
                  verticalAlign: "middle",
                }}
              />
            )}
          </span>
        </h1>

        {/* Subheading */}
        <p className="hero-reveal hero-reveal-delay-2 text-lg md:text-xl max-w-3xl mx-auto mb-12 leading-relaxed text-[var(--hero-text-muted)]">
          {tx(
            {
              en: "Continuous security validation, Red Team automation, and risk quantification. Bridge the gap between offensive findings and executive ROI.",
              es: "Validación continua de seguridad, automatización de Red Team y cuantificación de riesgos. Cierre la brecha entre hallazgos ofensivos y el ROI ejecutivo.",
            },
            lang,
          )}
        </p>

        {/* CTAs */}
        <div className="hero-reveal hero-reveal-delay-3 flex flex-col sm:flex-row gap-4 justify-center items-center">
          {/* Discord CTA — primary */}
          <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            <button
              className="flex items-center gap-3 px-8 py-4 font-bold uppercase tracking-widest transition-all hero-heading text-sm cursor-pointer rounded"
              style={{ background: "var(--hero-accent)", color: "#0A0E1A" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.579.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.3 14.3 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.36 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Z" />
              </svg>
              {tx(
                { en: "Join the Community", es: "Únete a la Comunidad" },
                lang,
              )}
            </button>
          </a>

          {/* GitHub — secondary */}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <button className="hero-btn-secondary px-8 py-4 font-bold uppercase tracking-widest hero-heading text-sm">
              {tx({ en: "View on GitHub", es: "Ver en GitHub" }, lang)}
            </button>
          </a>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROBLEM SECTION
// ═══════════════════════════════════════════════════════════════

function ProblemSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="problem"
      className="reveal-section py-24 px-6 border-t border-[var(--hero-grid-line)]"
      style={{ background: "#0A0E1A" }}
    >
      <div className="max-w-7xl mx-auto">
        <h2
          className="hero-heading text-2xl md:text-3xl font-bold mb-16 uppercase tracking-[0.15em] pl-6"
          style={{ borderLeft: "2px solid var(--hero-accent)" }}
        >
          {tx(
            {
              en: "The Problem with Traditional Validation",
              es: "El Problema con la Validación Tradicional",
            },
            lang,
          )}
        </h2>

        <div className="grid md:grid-cols-4 gap-8">
          {problemItems.map(({ Icon, title, desc }) => (
            <div key={title.en} className="space-y-4">
              <Icon
                className="w-6 h-6 text-[var(--hero-accent)]"
                strokeWidth={1.5}
              />
              <h3 className="hero-heading font-bold text-lg text-[var(--hero-text-primary)]">
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
// PLATFORM SECTION (screenshots — gallery layout)
// ═══════════════════════════════════════════════════════════════

const platformSlides = [
  {
    src: "assets/images/Scoring.png",
    label: { en: "Analytics Dashboard", es: "Panel de Analíticas" },
    title: {
      en: "Real-Time Defense Scoring",
      es: "Puntuación de Defensa en Tiempo Real",
    },
    desc: {
      en: "Track your Defense Score and Secure Score over time. Visualize trend data, identify detection gaps, and correlate findings with your SIEM and EDR telemetry.",
      es: "Rastrea tu Defense Score y Secure Score a lo largo del tiempo. Visualiza tendencias, identifica brechas de detección y correlaciona hallazgos con tu SIEM y EDR.",
    },
  },
  {
    src: "assets/images/Library.png",
    label: { en: "Security Browser", es: "Navegador de Seguridad" },
    title: {
      en: "MITRE ATT&CK Test Library",
      es: "Librería de Tests MITRE ATT&CK",
    },
    desc: {
      en: "Browse 500+ security tests mapped to MITRE ATT&CK. Filter by severity, tactic, or category. Top-rated tests surface the highest-value coverage opportunities.",
      es: "Explora más de 500 tests de seguridad mapeados a MITRE ATT&CK. Filtra por severidad, táctica o categoría. Los tests mejor valorados priorizan las mejores oportunidades de cobertura.",
    },
  },
  {
    src: "assets/images/Endpoint.png",
    label: { en: "Agent Dashboard", es: "Panel de Agentes" },
    title: {
      en: "Fleet-Wide Endpoint Management",
      es: "Gestión de Endpoints a Escala de Flota",
    },
    desc: {
      en: "Monitor your entire agent fleet in one view. Track uptime, task success rates, and health across all enrolled endpoints — with stale agent detection built in.",
      es: "Monitorea toda tu flota de agentes en una vista. Rastrea uptime, tasa de éxito de tareas y salud en todos los endpoints enrollados, con detección de agentes inactivos integrada.",
    },
  },
];

function PlatformSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="platform"
      className="reveal-section py-24 px-6 border-t border-[var(--hero-grid-line)]"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Section title */}
        <h2 className="hero-heading text-3xl font-bold mb-20 uppercase tracking-widest text-center">
          {tx(
            { en: "Platform in Action", es: "La Plataforma en Acción" },
            lang,
          )}
        </h2>

        {/* Alternating rows */}
        <div className="flex flex-col gap-24">
          {platformSlides.map((slide, i) => {
            const imageLeft = i % 2 === 0;
            const imageBlock = (
              <div className="lg:w-3/5 w-full">
                <div
                  className="cyber-border-card p-2 overflow-hidden"
                  style={{ background: "#0A0E1A" }}
                >
                  <img
                    src={slide.src}
                    alt={tx(slide.title, lang)}
                    className="w-full h-auto block"
                    style={{ opacity: 0.85 }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.opacity = "0.85")
                    }
                    onError={(e) => {
                      const target = e.currentTarget as HTMLImageElement;
                      target.style.display = "none";
                      const ph = target.nextElementSibling as HTMLElement;
                      if (ph) ph.style.display = "flex";
                    }}
                  />
                  <div
                    className="w-full items-center justify-center hero-mono text-[var(--hero-text-muted)] text-xs"
                    style={{ height: "240px", display: "none" }}
                  >
                    {tx(slide.title, lang)}
                  </div>
                </div>
              </div>
            );

            const textBlock = (
              <div className="lg:w-2/5 w-full flex flex-col justify-center gap-5">
                <span
                  className="hero-mono text-[10px] font-bold uppercase tracking-[0.3em] px-3 py-1 self-start"
                  style={{
                    color: "var(--hero-accent)",
                    border: "1px solid rgba(6, 149, 107, 0.3)",
                    background: "rgba(6, 149, 107, 0.05)",
                  }}
                >
                  {tx(slide.label, lang)}
                </span>

                <h3 className="hero-heading text-2xl md:text-3xl font-bold leading-snug">
                  {tx(slide.title, lang)}
                </h3>

                <p className="text-[var(--hero-text-muted)] leading-relaxed">
                  {tx(slide.desc, lang)}
                </p>

                {/* Slide index */}
                <span
                  className="hero-mono text-[10px] tracking-widest"
                  style={{ color: "var(--hero-accent)", opacity: 0.5 }}
                >
                  0{i + 1} / 0{platformSlides.length}
                </span>
              </div>
            );

            return (
              <div
                key={slide.src}
                className="flex flex-col lg:flex-row gap-12 items-center"
              >
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
// SOLUTION SECTION
// ═══════════════════════════════════════════════════════════════

function SolutionSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="solution"
      className="reveal-section py-24 px-6 relative overflow-hidden"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 items-center">
        {/* Left: feature list */}
        <div className="lg:w-1/2">
          <h2 className="hero-heading text-3xl font-bold mb-8">
            {tx(
              {
                en: "Project Achilles: Continuous Security Validation",
                es: "Project Achilles: Validación Continua de Seguridad",
              },
              lang,
            )}
          </h2>

          <ul className="space-y-6">
            {solutionItems.map(({ Icon, accent, title, desc }) => (
              <li key={title.en} className="flex items-start gap-4">
                <div
                  className="mt-1 p-2 rounded"
                  style={{
                    background: accent
                      ? "rgba(6, 149, 107, 0.1)"
                      : "rgba(255,255,255,0.05)",
                    border: accent
                      ? "1px solid rgba(6, 149, 107, 0.2)"
                      : "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <Icon
                    className="w-5 h-5"
                    strokeWidth={1.5}
                    style={{
                      color: accent
                        ? "var(--hero-accent)"
                        : "rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
                <div>
                  <strong className="block hero-heading text-sm uppercase tracking-wider text-[var(--hero-text-primary)]">
                    {tx(title, lang)}
                  </strong>
                  <span className="text-[var(--hero-text-muted)] text-sm">
                    {tx(desc, lang)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: terminal */}
        <div className="lg:w-1/2 w-full">
          <div className="hero-terminal">
            <div className="flex gap-2 mb-4">
              <span className="hero-terminal-dot" />
              <span className="hero-terminal-dot" />
              <span className="hero-terminal-dot" />
            </div>
            <p className="text-[var(--hero-text-muted)] mb-2">
              {"// Initializing Achilles Agent..."}
            </p>
            <p className="text-[var(--hero-text-primary)]">
              $ achilles emulate --technique T1059.001
            </p>
            <p style={{ color: "var(--hero-accent)" }}>
              [info] Executing PowerShell Execution Policy Bypass...
            </p>
            <p style={{ color: "var(--hero-accent-bright)" }}>
              [result] Technique Executed Successfully.
            </p>
            <p style={{ color: "#f87171" }}>[alert] SIEM Detection: FAILED</p>
            <p className="text-[var(--hero-text-muted)] mt-4">
              $ achilles generate-report --format board-level
            </p>
            <p style={{ color: "#fb923c" }}>
              [report] Risk Exposure: HIGH (Critical Gap in Endpoint Visibility)
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// METRICS SECTION
// ═══════════════════════════════════════════════════════════════

function MetricsSection({ lang }: { lang: Lang }) {
  return (
    <section
      id="metrics"
      className="reveal-section py-24 px-6 border-y border-[var(--hero-grid-line)]"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div className="max-w-7xl mx-auto text-center">
        <h2
          className="hero-heading text-3xl font-bold mb-12 uppercase tracking-[0.2em]"
          style={{ color: "var(--hero-accent)" }}
        >
          {tx(
            {
              en: "Executive Risk Quantification",
              es: "Cuantificación de Riesgo para Ejecutivos",
            },
            lang,
          )}
        </h2>

        <div className="grid md:grid-cols-2 gap-12 text-left">
          <div
            className="p-8"
            style={{
              borderLeft: "2px solid var(--hero-accent)",
              background: "rgba(6, 149, 107, 0.05)",
            }}
          >
            <h3 className="hero-heading text-xl font-bold mb-4 uppercase tracking-wider">
              {tx(
                { en: "Operational Necessity", es: "Necesidad Operacional" },
                lang,
              )}
            </h3>
            <p className="text-[var(--hero-text-muted)] italic text-sm">
              {tx(
                {
                  en: "Structured adversary simulation is no longer a luxury for Red Teams—it is a strategic requirement to validate that your multi-million dollar security stack actually works.",
                  es: "La simulación estructurada de adversarios ya no es un lujo para los Red Teams: es un requisito estratégico para validar que su inversión millonaria en seguridad realmente funciona.",
                },
                lang,
              )}
            </p>
          </div>

          <div
            className="p-8"
            style={{
              borderLeft: "2px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
            }}
          >
            <h3 className="hero-heading text-xl font-bold mb-4 uppercase tracking-wider">
              {tx(
                {
                  en: "Board-Level Metrics",
                  es: "Métricas para el Directorio",
                },
                lang,
              )}
            </h3>
            <p className="text-[var(--hero-text-muted)] italic text-sm">
              {tx(
                {
                  en: "We translate technical vulnerabilities into detection coverage percentages and risk scores, providing CISOs with the data needed to justify spend and prove ROI.",
                  es: "Traducimos vulnerabilidades técnicas en porcentajes de cobertura de detección y puntuaciones de riesgo, brindando a los CISOs los datos necesarios para justificar el gasto y demostrar el ROI.",
                },
                lang,
              )}
            </p>
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
      className="reveal-section py-24 px-6 relative"
      style={{ background: "var(--hero-bg-deep)" }}
    >
      <div
        className="max-w-4xl mx-auto border border-[var(--hero-grid-line)] p-12 rounded-2xl"
        style={{
          background: "linear-gradient(to bottom, #0A0E1A, transparent)",
        }}
      >
        <h2 className="hero-heading text-2xl font-bold mb-8 flex items-center gap-4 uppercase tracking-widest">
          <Sparkles
            className="w-6 h-6 text-[var(--hero-accent)]"
            strokeWidth={1.5}
          />
          {tx(
            {
              en: "The AI Factor: Agentic Development",
              es: "El Factor IA: Desarrollo Agéntico",
            },
            lang,
          )}
        </h2>

        <p className="text-[var(--hero-text-muted)] mb-6 leading-relaxed text-sm">
          {tx(
            {
              en: "ProjectAchilles wouldn't exist in its current state without LLM-assisted development. We believe in transparency: AI didn't just help us write code; it accelerated our tool development by 4x, allowing us to focus on complex logic while LLMs handled boilerplate and cross-platform agent compatibility.",
              es: "ProjectAchilles no existiría en su estado actual sin el desarrollo asistido por LLM. Creemos en la transparencia: la IA no solo nos ayudó a escribir código; aceleró el desarrollo de nuestras herramientas en un 4x, permitiéndonos enfocarnos en lógica compleja mientras los LLMs manejaban el código repetitivo y la compatibilidad de agentes multiplataforma.",
            },
            lang,
          )}
        </p>

        <p className="text-[var(--hero-text-muted)] leading-relaxed text-sm">
          {tx(
            {
              en: "This is the future of cybersecurity: Offensive and defensive tools built at the speed of thought.",
              es: "Este es el futuro de la ciberseguridad: herramientas ofensivas y defensivas construidas a la velocidad del pensamiento.",
            },
            lang,
          )}
        </p>
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
      className="py-20 px-6 border-t border-[var(--hero-grid-line)]"
      style={{ background: "#0A0E1A" }}
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
        <div>
          <h2 className="hero-heading text-2xl font-bold mb-4 uppercase tracking-widest">
            {tx(
              {
                en: "Join the Open Source Launch",
                es: "Únete al Lanzamiento Open Source",
              },
              lang,
            )}
          </h2>
          <p className="text-[var(--hero-text-muted)] text-sm hero-mono">
            {tx(
              {
                en: "The repository is live. Contribute, validate, and secure.",
                es: "El repositorio está activo. Colabora, valida y asegura.",
              },
              lang,
            )}
          </p>
        </div>

        <div className="flex gap-6">
          {/* GitHub */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-full text-[var(--hero-text-muted)] transition-all"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(6, 149, 107, 0.2)";
              e.currentTarget.style.color = "var(--hero-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              e.currentTarget.style.color = "var(--hero-text-muted)";
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>

          {/* Discord */}
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 rounded-full text-[var(--hero-text-muted)] transition-all"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(6, 149, 107, 0.2)";
              e.currentTarget.style.color = "var(--hero-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              e.currentTarget.style.color = "var(--hero-text-muted)";
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.579.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.3 14.3 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.36 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.211 0 2.166 1.095 2.157 2.418 0 1.333-.946 2.418-2.157 2.418Z" />
            </svg>
          </a>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-[var(--hero-grid-line)] flex flex-col sm:flex-row justify-between gap-4 text-[10px] uppercase tracking-[0.3em] text-[var(--hero-text-muted)] hero-mono">
        <p>&copy; {new Date().getFullYear()} Project Achilles.</p>
        <p>
          {tx(
            {
              en: "Crafted for the Strategic Security Professional",
              es: "Diseñado para el Profesional de Seguridad Estratégica",
            },
            lang,
          )}
        </p>
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

      {/* Content */}
      <div className="relative z-10">
        <HeroNav
          lang={lang}
          onToggleLang={() => setLang((l) => (l === "en" ? "es" : "en"))}
        />
        <HeroSection lang={lang} />
        <ProblemSection lang={lang} />
        <PlatformSection lang={lang} />
        <SolutionSection lang={lang} />
        <MetricsSection lang={lang} />
        <AIFactorSection lang={lang} />
        <HeroFooter lang={lang} />
      </div>
    </div>
  );
}
