import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ProjectAchilles',
  tagline: 'Continuous security validation — from threat intelligence to defense readiness',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.projectachilles.io',
  baseUrl: '/',

  organizationName: 'projectachilles',
  projectName: 'ProjectAchilles',
  onBrokenLinks: 'throw',

  clientModules: [
    './src/mermaid-zoom.js',
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/projectachilles/ProjectAchilles/tree/main/wiki/',
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo-achilles.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      // Brand block is rendered by src/theme/Navbar/Logo — the console
      // wordmark (f0 + _csv accent + pulsing cursor), not a title/logo pair.
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/api-reference/overview',
          label: 'API',
          position: 'left',
        },
        {
          href: 'https://github.com/projectachilles/ProjectAchilles',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/introduction'},
            {label: 'Deployment', to: '/docs/deployment/overview'},
            {label: 'User Guide', to: '/docs/user-guide/authentication/oauth-providers'},
            {label: 'Developer Guide', to: '/docs/developer-guide/development-setup'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'Contributing', to: '/docs/community/contributing'},
            {label: 'Code of Conduct', to: '/docs/community/code-of-conduct'},
            {label: 'Roadmap', to: '/docs/community/roadmap'},
          ],
        },
        {
          title: 'Security',
          items: [
            {label: 'Security Policy', to: '/docs/security/security-policy'},
            {label: 'Report a Vulnerability', to: '/docs/security/vulnerability-reporting'},
            {label: 'GitHub Advisories', href: 'https://github.com/projectachilles/ProjectAchilles/security/advisories'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/projectachilles/ProjectAchilles'},
            {label: 'Changelog', to: '/docs/community/changelog'},
          ],
        },
      ],
      copyright: `Measure your defenses. Close the gaps. Prove the investment.<br/>Copyright \u00a9 ${new Date().getFullYear()} ProjectAchilles Contributors. Licensed under Apache 2.0.`,
    },
    prism: {
      // Single dark theme site — both slots point at the dark palette.
      theme: prismThemes.vsDark,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ['bash', 'go', 'typescript', 'powershell', 'json', 'toml', 'yaml', 'sql'],
    },
    mermaid: {
      theme: {light: 'dark', dark: 'dark'},
      options: {
        themeVariables: {
          background: '#0b100c',
          primaryColor: '#101713',
          primaryTextColor: '#dce8de',
          primaryBorderColor: '#2c3a30',
          secondaryColor: '#12271a',
          tertiaryColor: '#162019',
          lineColor: '#5f7268',
          textColor: '#dce8de',
          mainBkg: '#101713',
          nodeBorder: '#2c3a30',
          // Subgraph containers default to a light grey — pin them to surface.
          clusterBkg: '#0b100c',
          clusterBorder: '#1c261f',
          edgeLabelBackground: '#0b100c',
          titleColor: '#8fa598',
          // Sequence diagrams
          actorBkg: '#101713',
          actorBorder: '#2c3a30',
          actorTextColor: '#dce8de',
          actorLineColor: '#2c3a30',
          signalColor: '#8fa598',
          signalTextColor: '#dce8de',
          labelBoxBkg: '#12271a',
          labelBoxBorderColor: '#2c3a30',
          labelTextColor: '#dce8de',
          loopTextColor: '#dce8de',
          noteBkgColor: '#162019',
          noteBorderColor: '#2c3a30',
          noteTextColor: '#dce8de',
          activationBkgColor: '#12271a',
          activationBorderColor: '#3ef08a',
          sequenceNumberColor: '#03170b',
          fontFamily:
            '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
        },
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
