/** Default UI locale (de) labels for shell e2e locators — keep in sync with locales/de/*.json */
export const DE_SHELL = {
  coreModulesNav: 'Kernmodule',
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
