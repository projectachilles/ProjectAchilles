import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ProjectAchilles',
  tagline: 'The Open-Source Purple Team Platform for Continuous Security Validation',
  favicon: 'img/logo-achilles.png',

  future: {
    v4: true,
  },

  url: 'https://docs.projectachilles.io',
  baseUrl: '/',

  organizationName: 'projectachilles',
  projectName: 'ProjectAchilles',
  trailingSlash: false,

  onBrokenLinks: 'throw',

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
          showLastUpdateTime: true,
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
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ProjectAchilles',
      logo: {
        alt: 'ProjectAchilles Logo',
        src: 'img/logo-achilles.png',
      },
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
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} ProjectAchilles Contributors. Licensed under Apache 2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'go', 'typescript', 'powershell', 'json', 'toml', 'yaml', 'sql'],
    },
    mermaid: {
      theme: {light: 'default', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
