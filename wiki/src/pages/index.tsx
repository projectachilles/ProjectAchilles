import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const features = [
  {
    title: 'Test Browser',
    icon: '\uD83D\uDD0D',
    description:
      'Browse a git-synced library of security tests with MITRE ATT&CK mapping. Filter by technique, tactic, platform, and severity. Build, sign, and download binaries directly from the UI.',
    link: '/docs/user-guide/test-browser/browsing-filtering',
  },
  {
    title: 'Analytics Dashboard',
    icon: '\uD83D\uDCCA',
    description:
      'Measure your defensive posture with 30+ Elasticsearch query endpoints. Defense scores, heatmaps, treemaps, trend analysis, and risk acceptance tracking.',
    link: '/docs/user-guide/analytics/defense-score',
  },
  {
    title: 'Agent System',
    icon: '\uD83D\uDEE1\uFE0F',
    description:
      'Deploy a lightweight Go agent to Windows, Linux, and macOS endpoints. Token-based enrollment, heartbeat monitoring, task execution, and self-updating.',
    link: '/docs/user-guide/agent-management/enrollment',
  },
  {
    title: 'Build & Sign',
    icon: '\u2699\uFE0F',
    description:
      'Cross-compile test binaries for any platform from the web UI. Authenticode signing for Windows, ad-hoc signing for macOS, and multi-certificate management.',
    link: '/docs/user-guide/test-browser/building-signing',
  },
  {
    title: 'Integrations',
    icon: '\uD83D\uDD17',
    description:
      'Connect Microsoft 365 Defender for Secure Score and alert cross-correlation. Set up Slack and email alerting with configurable thresholds.',
    link: '/docs/user-guide/integrations/elasticsearch',
  },
  {
    title: '5 Deployment Targets',
    icon: '\uD83D\uDE80',
    description:
      'Deploy anywhere: Docker Compose, Railway, Render, Fly.io, or Vercel (serverless). Each target has a dedicated guide with production hardening steps.',
    link: '/docs/deployment/overview',
  },
];

function HomepageHeader(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="hero hero--achilles">
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem', flexWrap: 'wrap'}}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/introduction">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="/docs/deployment/overview"
            style={{color: '#fff', borderColor: 'rgba(255,255,255,0.5)'}}>
            Deploy
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({title, icon, description, link}: (typeof features)[0]): ReactNode {
  return (
    <div className="col col--4" style={{marginBottom: '1.5rem'}}>
      <Link to={link} style={{textDecoration: 'none', color: 'inherit'}}>
        <div className="feature-card" style={{height: '100%'}}>
          <span style={{fontSize: '2rem'}}>{icon}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </Link>
    </div>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Documentation"
      description="ProjectAchilles — The Open-Source Purple Team Platform for Continuous Security Validation. Execute security tests, measure detection coverage, close defensive gaps.">
      <HomepageHeader />
      <main>
        <section style={{padding: '3rem 0'}}>
          <div className="container">
            <div className="row">
              {features.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
