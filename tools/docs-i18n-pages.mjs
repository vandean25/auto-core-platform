/** Shared Mintlify page tree for de-AT (root) and en (/en/) locales. */
export const guidesGroups = [
  {
    groupKey: 'gettingStarted',
    pages: ['introduction', 'changelog', 'quickstart', 'workflows'],
  },
  {
    groupKey: 'dailyWork',
    pages: ['workflows/sign-in', 'workflows/dashboard', 'workflows/keyboard-shortcuts'],
  },
  { groupKey: 'people', pages: ['hr'] },
  {
    groupKey: 'sales',
    pages: [
      'workflows/customers',
      'workflows/vehicles',
      'workflows/sales-orders',
      'workflows/invoices',
    ],
  },
  {
    groupKey: 'finance',
    pages: [
      'workflows/credit-notes',
      'workflows/accounting-export',
      'settings/document-branding',
    ],
  },
  {
    groupKey: 'workshop',
    pages: [
      'workflows/workshop-intake',
      'workflows/workshop-orders',
      'workflows/workshop-check-in',
      'workflows/warranty-claims',
      'workflows/workshop-planner',
      'workflows/workshop-board',
      'workflows/workshop-pick',
      'workflows/mechanic',
      'workflows/workshop-capacity',
      'workflows/workshop-kpis',
      'workflows/loaner-vehicles',
      'workflows/tyre-storage',
    ],
  },
  {
    groupKey: 'vehiclesTrading',
    pages: ['workflows/vehicle-stock', 'workflows/listings-export'],
  },
  {
    groupKey: 'austriaCompliance',
    pages: [
      'workflows/pickerl-due',
      'workflows/nova',
      'workflows/statutory-warranty-due',
    ],
  },
  {
    groupKey: 'inventory',
    pages: ['workflows/inventory', 'workflows/stock-transfers'],
  },
  {
    groupKey: 'procurement',
    pages: [
      'workflows/vendors',
      'workflows/purchase-orders',
      'workflows/purchase-bills',
    ],
  },
  {
    groupKey: 'platform',
    pages: [
      'workflows/platform-tenants',
      'workflows/sites',
      'workflows/agent-supervision',
    ],
  },
];

export const settingsGroups = [
  { groupKey: 'allSettings', pages: ['settings'] },
  {
    groupKey: 'finance',
    pages: [
      'settings/finance',
      'settings/legal-entities',
      'settings/document-branding',
      'settings/revenue-groups',
    ],
  },
  { groupKey: 'organization', pages: ['settings/sites'] },
  {
    groupKey: 'workshop',
    pages: [
      'settings/employees',
      'settings/bays',
      'settings/labor',
      'settings/voice-translation',
    ],
  },
  {
    groupKey: 'masterData',
    pages: [
      'settings/brands',
      'settings/storage-locations',
      'settings/vehicle-data',
      'settings/margin-rules',
    ],
  },
  { groupKey: 'access', pages: ['settings/team'] },
  {
    groupKey: 'integrations',
    pages: ['settings/data-import', 'settings/api-keys'],
  },
  { groupKey: 'auditCompliance', pages: ['settings/audit-logs'] },
];

export const operationsGroups = [
  {
    groupKey: 'diagnostics',
    pages: [
      'operations/runtime-diagnostics',
      'operations/core-api-scheduled-jobs',
    ],
  },
];

export const groupLabels = {
  de: {
    gettingStarted: 'Einstieg',
    dailyWork: 'Tägliche Arbeit',
    people: 'Personal',
    sales: 'Verkauf',
    finance: 'Finanzen',
    workshop: 'Werkstatt',
    vehiclesTrading: 'Fahrzeuge & Handel',
    austriaCompliance: 'Österreich & Compliance',
    inventory: 'Lager',
    procurement: 'Einkauf',
    platform: 'Plattform',
    allSettings: 'Alle Einstellungen',
    organization: 'Organisation',
    masterData: 'Stammdaten',
    access: 'Zugriff',
    integrations: 'Integrationen',
    auditCompliance: 'Audit & Compliance',
    diagnostics: 'Diagnose',
  },
  en: {
    gettingStarted: 'Getting started',
    dailyWork: 'Daily work',
    people: 'People',
    sales: 'Sales',
    finance: 'Finance',
    workshop: 'Workshop',
    vehiclesTrading: 'Vehicles and trading',
    austriaCompliance: 'Austria compliance',
    inventory: 'Inventory',
    procurement: 'Procurement',
    platform: 'Platform',
    allSettings: 'All settings',
    organization: 'Organization',
    masterData: 'Master data',
    access: 'Access',
    integrations: 'Integrations',
    auditCompliance: 'Audit & compliance',
    diagnostics: 'Diagnostics',
  },
};

export const tabLabels = {
  de: { guides: 'Anleitungen', settings: 'Einstellungen', operations: 'Betrieb' },
  en: { guides: 'Guides', settings: 'Settings', operations: 'Operations' },
};

export function buildTabs(locale, prefix = '') {
  const labels = groupLabels[locale];
  const tabs = tabLabels[locale];
  const withPrefix = (page) => (prefix ? `${prefix}/${page}` : page);

  return [
    {
      tab: tabs.guides,
      icon: 'book-open',
      groups: guidesGroups.map(({ groupKey, pages }) => ({
        group: labels[groupKey],
        pages: pages.map(withPrefix),
      })),
    },
    {
      tab: tabs.settings,
      icon: 'settings',
      groups: settingsGroups.map(({ groupKey, pages }) => ({
        group: labels[groupKey],
        pages: pages.map(withPrefix),
      })),
    },
    {
      tab: tabs.operations,
      icon: 'activity',
      groups: operationsGroups.map(({ groupKey, pages }) => ({
        group: labels[groupKey],
        pages: pages.map(withPrefix),
      })),
    },
  ];
}

/** All public doc slugs (no extension) at the default-locale root. */
export function allPageSlugs() {
  const slugs = new Set();
  for (const { pages } of [
    ...guidesGroups,
    ...settingsGroups,
    ...operationsGroups,
  ]) {
    for (const page of pages) slugs.add(page);
  }
  return [...slugs].sort();
}
