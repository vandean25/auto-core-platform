/** Default UI locale (de) labels for shell e2e locators — keep in sync with locales/de/*.json */
export const DE_SHELL = {
  mainNavigation: 'Hauptnavigation',
  sidebar: {
    toggle: 'Seitenleiste ein- oder ausblenden',
  },
  modules: {
    customers: 'Kunden',
    salesOrders: 'Kundenaufträge',
    salesInvoices: 'Rechnungen',
    workshopOrders: 'Werkstattaufträge',
  },
  favorites: {
    empty:
      'Noch keine gespeicherten Ansichten. Setzen Sie Filter in einer Tabelle und wählen Sie „Als Seitenleistenansicht speichern“.',
  },
  user: {
    // The account of the e2e auth bypass (src/auth/AuthProvider.tsx).
    accountEmail: 'testauto@auto.core.at',
    helpDocs: 'Hilfe / Dokumentation',
  },
  errorBoundary: {
    chunkTitle: 'Aktualisierung erforderlich',
    reload: 'Anwendung neu laden',
  },
  login: {
    email: 'E-Mail',
    password: 'Passwort',
    signIn: 'Anmelden',
  },
} as const
