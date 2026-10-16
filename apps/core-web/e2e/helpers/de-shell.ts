/** Default UI locale (de) labels for shell e2e locators — keep in sync with locales/de/*.json */
export const DE_SHELL = {
  coreModulesNav: 'Kernmodule',
  modules: {
    customers: 'Kunden',
    salesOrders: 'Kundenaufträge',
    salesInvoices: 'Rechnungen',
  },
  favorites: {
    empty:
      'Noch keine gespeicherten Ansichten. Filter in einer Tabelle setzen und „Als Seitenleistenansicht speichern“ wählen.',
  },
  footer: {
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
