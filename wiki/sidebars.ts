import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/introduction',
        'getting-started/features',
        'getting-started/architecture',
        'getting-started/quick-start-local',
        'getting-started/quick-start-docker',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        'deployment/overview',
        'deployment/prerequisites',
        'deployment/docker-compose',
        'deployment/railway',
        'deployment/render',
        'deployment/fly-io',
        'deployment/vercel',
        'deployment/production-checklist',
        'deployment/environment-variables',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      items: [
        {
          type: 'category',
          label: 'Authentication',
          items: [
            'user-guide/authentication/oauth-providers',
            'user-guide/authentication/email-password',
          ],
        },
        {
          type: 'category',
          label: 'Test Browser',
          items: [
            'user-guide/test-browser/browsing-filtering',
            'user-guide/test-browser/test-detail-pages',
            'user-guide/test-browser/building-signing',
            'user-guide/test-browser/custom-tests',
          ],
        },
        {
          type: 'category',
          label: 'Analytics Dashboard',
          items: [
            'user-guide/analytics/defense-score',
            'user-guide/analytics/heatmaps-treemaps',
            'user-guide/analytics/execution-table',
            'user-guide/analytics/multi-index',
            'user-guide/analytics/risk-acceptance',
            'user-guide/analytics/microsoft-defender',
          ],
        },
        {
          type: 'category',
          label: 'Agent Management',
          items: [
            'user-guide/agent-management/enrollment',
            'user-guide/agent-management/deploying-agents',
            'user-guide/agent-management/heartbeat-monitoring',
            'user-guide/agent-management/task-execution',
            'user-guide/agent-management/task-scheduling',
            'user-guide/agent-management/self-updates',
            'user-guide/agent-management/remote-uninstall',
          ],
        },
        {
          type: 'category',
          label: 'Integrations',
          items: [
            'user-guide/integrations/elasticsearch',
            'user-guide/integrations/microsoft-defender',
            'user-guide/integrations/alerting',
          ],
        },
        {
          type: 'category',
          label: 'Settings',
          items: [
            'user-guide/settings/certificates',
            'user-guide/settings/visual-themes',
            'user-guide/settings/notifications',
          ],
        },
        {
          type: 'category',
          label: 'CLI Tool',
          items: [
            'user-guide/cli/overview',
            'user-guide/cli/authentication',
            'user-guide/cli/agent-commands',
            'user-guide/cli/task-schedule-commands',
            'user-guide/cli/analytics-commands',
            'user-guide/cli/build-cert-commands',
            'user-guide/cli/chat-agent',
            'user-guide/cli/configuration',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      items: [
        'developer-guide/development-setup',
        'developer-guide/project-structure',
        {
          type: 'category',
          label: 'Frontend',
          items: [
            'developer-guide/frontend/react-patterns',
            'developer-guide/frontend/redux-state',
            'developer-guide/frontend/auth-hooks',
            'developer-guide/frontend/ui-components',
          ],
        },
        {
          type: 'category',
          label: 'Backend',
          items: [
            'developer-guide/backend/routes-middleware',
            'developer-guide/backend/es-module-imports',
            'developer-guide/backend/error-handling',
            'developer-guide/backend/database-migrations',
            'developer-guide/backend/test-browser-service',
            'developer-guide/backend/test-management-service',
            'developer-guide/backend/analytics-service',
          ],
        },
        {
          type: 'category',
          label: 'Agent (Go)',
          items: [
            'developer-guide/agent/architecture',
            'developer-guide/agent/platform-specific',
            'developer-guide/agent/build-cross-compilation',
            'developer-guide/agent/code-signing',
          ],
        },
        'developer-guide/backend-serverless',
        'developer-guide/test-library',
        'developer-guide/container-extension',
        'developer-guide/testing',
        'developer-guide/ci-cd',
        'developer-guide/contributing',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/overview',
        'api-reference/browser',
        'api-reference/analytics',
        'api-reference/agent-admin',
        'api-reference/agent-device',
        'api-reference/build-certificates',
        'api-reference/defender',
        'api-reference/alerting',
        'api-reference/bundle-results',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        'security/security-policy',
        'security/authentication-model',
        'security/agent-security',
        'security/agent-security-report',
        'security/vulnerability-reporting',
      ],
    },
    {
      type: 'category',
      label: 'Community',
      items: [
        'community/contributing',
        'community/code-of-conduct',
        'community/roadmap',
        'community/changelog',
      ],
    },
  ],
};

export default sidebars;
