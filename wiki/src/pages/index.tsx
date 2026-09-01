import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

type Feature = {
  label: string;
  title: string;
  description: string;
  link: string;
};

const features: Feature[] = [
  {
    label: 'dashboard',
    title: 'Unified Security Dashboard',
    description:
      'One command centre for posture across tests, endpoints, and analytics — KPI strip, attention banner, trend overview, and ATT&CK coverage, with a 7d/30d/90d range selector.',
    link: '/docs/getting-started/features',
  },
  {
    label: 'authoring',
    title: 'AI-Powered Test Development',
    description:
      'A multi-agent pipeline turns threat intelligence into complete test packages — binaries, detection rules in five formats, hardening scripts, and kill chain diagrams.',
    link: '/docs/getting-started/features',
  },
  {
    label: 'library',
    title: 'Test Browser',
    description:
      'Browse the git-synced library with MITRE ATT&CK mapping. Facet by category, severity, platform, and threat actor. Build, sign, and dispatch straight from the UI.',
    link: '/docs/user-guide/test-browser/browsing-filtering',
  },
  {
    label: 'execution',
    title: 'Endpoint Agent Fleet',
    description:
      'A lightweight Go agent for Windows, Linux, and macOS. Token enrollment, heartbeat monitoring, self-update, dual-key rotation, and a live task stream with retry.',
    link: '/docs/user-guide/agent-management/enrollment',
  },
  {
    label: 'measurement',
    title: 'Analytics & Defense Score',
    description:
      'Thirty-plus Elasticsearch endpoints behind a Defense Score ledger, per-host coverage treemaps, technique distribution, and executions master-detail with risk acceptance.',
    link: '/docs/user-guide/analytics/defense-score',
  },
  {
    label: 'integrations',
    title: 'Microsoft Defender & Alerting',
    description:
      'Secure Score correlation, alert cross-matching, and opt-in auto-resolve for Achilles-generated alerts. Slack and email alerting on score thresholds.',
    link: '/docs/user-guide/integrations/microsoft-defender',
  },
  {
    label: 'automation',
    title: 'CLI & API Keys',
    description:
      'The `achilles` CLI plus scoped API keys for read, read-write, and admin automation — dispatch tests, pull analytics, and wire results into your own pipelines.',
    link: '/docs/api-reference/programmatic-access',
  },
  {
    label: 'deployment',
    title: 'Seven Deployment Targets',
    description:
      'Docker Compose, self-hosted or on-prem server behind Caddy, Railway, Render, Fly.io, or Vercel serverless — each with a dedicated hardening guide.',
    link: '/docs/deployment/overview',
  },
];

const stats = [
  {value: '30+', label: 'Elasticsearch analytics endpoints'},
  {value: '4', label: 'Agent platform targets'},
  {value: '7', label: 'Supported deployment targets'},
  {value: '5', label: 'Detection rule output formats'},
];

function Hero(): ReactNode {
  return (
    <header className="f0-hero">
      <div className="f0-hero__inner">
        <div className="f0-hero__mark">
          <span className="f0-brand__prefix">f0</span>
          <span className="f0-brand__suffix">_csv</span>
          <span className="f0-brand__cursor" aria-hidden="true" />
        </div>
        <p className="f0-hero__eyebrow">projectachilles documentation</p>
        <Heading as="h1" className="f0-hero__title">
          Continuous security validation — from threat intelligence to defense
          readiness
        </Heading>
        <p className="f0-hero__subtitle">
          Stop hoping your defenses work. Deploy the agent, run the library,
          and measure what your stack actually blocks.
        </p>
        <div className="f0-hero__actions">
          <Link
            className="f0-btn f0-btn--primary"
            to="/docs/getting-started/introduction">
            Get started
          </Link>
          <Link className="f0-btn f0-btn--ghost" to="/docs/deployment/overview">
            Deploy
          </Link>
          <Link
            className="f0-btn f0-btn--ghost"
            to="/docs/api-reference/overview">
            API reference
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({label, title, description, link}: Feature): ReactNode {
  return (
    <Link to={link} className="f0-card">
      <div className="f0-card__label">{label}</div>
      <div className="f0-card__title">{title}</div>
      <p className="f0-card__body">{description}</p>
    </Link>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Documentation"
      description="ProjectAchilles — continuous security validation. Turn threat intelligence into executable tests, measure defense readiness, and close the gaps.">
      <Hero />
      <main>
        <section className="f0-section">
          <div className="f0-section__label">what you get</div>
          <div className="f0-grid">
            {features.map((feature) => (
              <FeatureCard key={feature.title} {...feature} />
            ))}
          </div>
        </section>

        <section className="f0-section" style={{paddingTop: 0}}>
          <div className="f0-section__label">at a glance</div>
          <div className="f0-stats">
            {stats.map((stat) => (
              <div className="f0-stat" key={stat.label}>
                <div className="f0-stat__value">{stat.value}</div>
                <div className="f0-stat__label">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
