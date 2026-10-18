#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTabs } from './docs-i18n-pages.mjs';

const docsPath = new URL('../docs.json', import.meta.url);
const docs = JSON.parse(readFileSync(docsPath, 'utf8'));

docs.seo = {
  metatags: {
    description:
      'Hilfe für Auto Core Platform — Werkstatt- und Händlersoftware für Österreich und DACH: Aufträge, Teile, Rechnungen und Einstellungen.',
    'og:title': 'Auto Core Platform Dokumentation',
    'og:description':
      'Rollenbasierte Anleitungen für Serviceberater, Mechaniker, Buchhaltung und Inhaber.',
    'og:site_name': 'Auto Core Platform',
    'twitter:card': 'summary',
    'twitter:title': 'Auto Core Platform Dokumentation',
    'twitter:description':
      'Werkstatt- und Händler-DMS-Hilfe für Österreich und DACH.',
  },
};

delete docs.navbar;
delete docs.banner;
delete docs.footer;

docs.navigation = {
  languages: [
    {
      language: 'de-AT',
      default: true,
      navbar: {
        links: [
          {
            type: 'github',
            href: 'https://github.com/vandean25/auto-core-platform',
          },
        ],
        primary: {
          type: 'button',
          label: 'Live-Demo',
          href: 'https://auto-core-platform-vande.web.app/',
        },
      },
      banner: {
        content:
          'Testen Sie die [Live-Demo](https://auto-core-platform-vande.web.app/) oder den [Quellcode auf GitHub](https://github.com/vandean25/auto-core-platform).',
        dismissible: true,
        type: 'info',
      },
      footer: {
        socials: {
          github: 'https://github.com/vandean25/auto-core-platform',
        },
        links: [
          {
            header: 'Produkt',
            items: [
              {
                label: 'Live-Demo',
                href: 'https://auto-core-platform-vande.web.app/',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/vandean25/auto-core-platform',
              },
            ],
          },
        ],
      },
      tabs: buildTabs('de'),
    },
    {
      language: 'en',
      navbar: {
        links: [
          {
            type: 'github',
            href: 'https://github.com/vandean25/auto-core-platform',
          },
        ],
        primary: {
          type: 'button',
          label: 'Live demo',
          href: 'https://auto-core-platform-vande.web.app/',
        },
      },
      banner: {
        content:
          'Try the [live demo](https://auto-core-platform-vande.web.app/) or browse the [source on GitHub](https://github.com/vandean25/auto-core-platform).',
        dismissible: true,
        type: 'info',
      },
      footer: {
        socials: {
          github: 'https://github.com/vandean25/auto-core-platform',
        },
        links: [
          {
            header: 'Product',
            items: [
              {
                label: 'Live demo',
                href: 'https://auto-core-platform-vande.web.app/',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/vandean25/auto-core-platform',
              },
            ],
          },
        ],
      },
      seo: {
        metatags: {
          description:
            'Guides for Auto Core Platform — workshop and dealer software for Austria and DACH: jobs, parts, invoices, and settings.',
          'og:title': 'Auto Core Platform documentation',
          'og:description':
            'Role-based help for service advisors, mechanics, accounting, and owners using Auto Core Platform.',
          'og:site_name': 'Auto Core Platform',
          'twitter:card': 'summary',
          'twitter:title': 'Auto Core Platform documentation',
          'twitter:description':
            'Workshop and dealer DMS guides for Austria and DACH.',
        },
      },
      tabs: buildTabs('en', 'en'),
    },
  ],
};

// Legacy paths that no longer exist at the same slug (English now lives under /en/).
docs.redirects = [
  {
    source: '/docs/workflows/workshop-kpis',
    destination: '/workflows/workshop-kpis',
    permanent: true,
  },
];

writeFileSync(docsPath, `${JSON.stringify(docs, null, 2)}\n`);
console.log(
  `Updated docs.json with ${docs.navigation.languages.length} languages and ${docs.redirects.length} legacy redirects.`,
);
