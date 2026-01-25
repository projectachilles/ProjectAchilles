import { Link } from 'react-router-dom';
import { Shield, Search, BarChart3, Server, ChevronRight } from 'lucide-react';
import CyberVisualization from '../components/hero/CyberVisualization';
import AchillesLogo from '../components/hero/AchillesLogo';

// ═══════════════════════════════════════════════════════════════
// ACHILLES HERO PAGE - TACTICAL COMMAND CENTER
// ═══════════════════════════════════════════════════════════════

const features = [
  {
    icon: Search,
    title: 'Security Browser',
    description: 'Browse and analyze security tests with advanced filtering. Search through test results, view detailed findings, and track remediation progress.',
    href: '/sign-in',
  },
  {
    icon: BarChart3,
    title: 'Analytics Dashboard',
    description: 'Real-time analytics powered by Elasticsearch. Visualize defense scores, track trends over time, and identify security gaps across your infrastructure.',
    href: '/sign-in',
  },
  {
    icon: Server,
    title: 'Endpoint Management',
    description: 'Manage endpoints via LimaCharlie integration. Monitor sensors, deploy payloads, and correlate events across your entire security landscape.',
    href: '/sign-in',
  },
];

const stats = [
  { value: '500+', label: 'Security Tests' },
  { value: '3', label: 'Integrated Modules' },
  { value: '24/7', label: 'Real-time Analytics' },
];

// ─────────────────────────────────────────────────────────────────
// NAV COMPONENT
// ─────────────────────────────────────────────────────────────────
function HeroNav() {
  return (
    <nav className="hero-nav hero-reveal">
      <Link to="/" className="flex items-center gap-2">
        <Shield className="w-6 h-6 text-[var(--hero-accent)]" strokeWidth={1.5} />
        <AchillesLogo size="md" />
      </Link>
      <div className="flex items-center gap-4">
        <Link to="/sign-in" className="hero-nav-link">
          Sign In
        </Link>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────
// HERO SECTION
// ─────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24">
      {/* Cyber visualization */}
      <div className="hero-reveal-scale mb-6">
        <CyberVisualization />
      </div>

      {/* Tagline */}
      <h1 className="hero-heading hero-reveal hero-reveal-delay-1 text-4xl md:text-5xl lg:text-6xl text-center mb-4">
        <span className="hero-glow-text">Security testing</span>
        <br />
        <span className="text-[var(--hero-accent)]">with proven value</span>
      </h1>

      {/* Sub-headline */}
      <p className="hero-subheading hero-reveal hero-reveal-delay-2 text-lg md:text-xl text-center max-w-2xl mb-10">
        Unified platform for security test management, real-time analytics,
        and endpoint monitoring. One command center for your entire security operation.
      </p>

      {/* CTA Buttons */}
      <div className="hero-reveal hero-reveal-delay-3 flex flex-col sm:flex-row gap-4">
        <Link to="/sign-in" className="hero-btn-primary">
          Get Started
          <ChevronRight className="w-5 h-5" />
        </Link>
        <a href="#features" className="hero-btn-secondary">
          Learn More
        </a>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hero-reveal hero-reveal-delay-5">
        <div className="w-6 h-10 rounded-full border border-[var(--hero-grid-line)] flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-[var(--hero-accent)] rounded-full animate-bounce" />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// FEATURES SECTION
// ─────────────────────────────────────────────────────────────────
function FeaturesSection() {
  return (
    <section id="features" className="relative py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="hero-heading hero-reveal text-3xl md:text-4xl mb-4">
            Three Modules. One Platform.
          </h2>
          <p className="hero-body hero-reveal hero-reveal-delay-1 max-w-xl mx-auto">
            Everything you need to manage, analyze, and monitor your security testing operations.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Link
              key={feature.title}
              to={feature.href}
              className={`hero-card hero-reveal hero-reveal-delay-${index + 2} group block`}
            >
              <div className="hero-card-icon">
                <feature.icon className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <h3 className="hero-heading text-xl mb-3 group-hover:text-[var(--hero-accent-bright)] transition-colors">
                {feature.title}
              </h3>
              <p className="hero-body text-sm">
                {feature.description}
              </p>
              <div className="mt-4 flex items-center gap-2 text-[var(--hero-accent)] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Explore</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// STATS SECTION
// ─────────────────────────────────────────────────────────────────
function StatsSection() {
  return (
    <section className="relative py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="hero-card hero-glow-border hero-reveal grid grid-cols-3 sm:grid-cols-3">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={`hero-stat hero-reveal hero-reveal-delay-${index + 1}`}
            >
              <div className="hero-stat-value">{stat.value}</div>
              <div className="hero-stat-label">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────────
function HeroFooter() {
  return (
    <footer className="relative py-8 px-6 border-t border-[var(--hero-grid-line)]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-[var(--hero-accent)]" strokeWidth={1.5} />
          <span className="hero-mono text-[var(--hero-text-muted)] text-sm">
            ACHILLES Security Platform
          </span>
        </div>
        <div className="hero-mono text-[var(--hero-text-muted)] text-xs">
          &copy; {new Date().getFullYear()} F0RT1KA. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN HERO PAGE
// ─────────────────────────────────────────────────────────────────
export default function HeroPage() {
  return (
    <div className="min-h-screen bg-[var(--hero-bg-deep)] text-[var(--hero-text-primary)] overflow-x-hidden">
      {/* Animated grid background */}
      <div className="hero-grid-bg">
        <div className="hero-grid-pulse" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        <HeroNav />
        <HeroSection />
        <FeaturesSection />
        <StatsSection />
        <HeroFooter />
      </div>
    </div>
  );
}
