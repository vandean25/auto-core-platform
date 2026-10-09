export type Language = 'en' | 'de'

export type BilingualCopy = {
  en: string
  de: string
}

export function getCopy(copy: BilingualCopy, lang: Language = 'en'): string {
  return copy[lang] ?? copy.en
}

export const SUPERVISION_COPY = {
  banner: {
    title: {
      en: 'Agent Supervision Active',
      de: 'Agenten-Überwachung aktiv',
    },
    description: {
      en: 'Agent supervision active: proposed agent actions require supervisor approval before execution. HUMAN_ONLY actions must be performed manually.',
      de: 'Agenten-Überwachung aktiv: Vorgeschlagene Aktionen erfordern eine Genehmigung vor der Ausführung. HUMAN_ONLY Aktionen müssen manuell durchgeführt werden.',
    },
    badge: {
      en: 'Supervision Mode',
      de: 'Überwachungsmodus',
    },
  },
  header: {
    title: {
      en: 'Agent Supervision',
      de: 'Agenten-Überwachung',
    },
    subtitle: {
      en: 'Approve or reject queue for proposed agent actions and audit agent activities.',
      de: 'Genehmigungswarteschlange für vorgeschlagene Agenten-Aktionen und Aktivitätenprotokoll.',
    },
  },
  tabs: {
    approvals: {
      en: 'Approvals',
      de: 'Genehmigungen',
    },
    activity: {
      en: 'Activity',
      de: 'Aktivitäten',
    },
    decisionShadow: {
      en: 'Decision shadow',
      de: 'Entscheidungs-Schatten',
    },
  },
  approvals: {
    pendingOnly: {
      en: 'Pending only',
      de: 'Nur ausstehend',
    },
    showAll: {
      en: 'Show all statuses',
      de: 'Alle Status anzeigen',
    },
    statusFilter: {
      en: 'Status',
      de: 'Status',
    },
    action: {
      en: 'Action',
      de: 'Aktion',
    },
    agent: {
      en: 'Proposed by',
      de: 'Vorgeschlagen von',
    },
    tier: {
      en: 'Policy Tier',
      de: 'Richtlinien-Stufe',
    },
    context: {
      en: 'Context / Target',
      de: 'Kontext / Ziel',
    },
    target: {
      en: 'Target',
      de: 'Ziel',
    },
    amount: {
      en: 'Amount',
      de: 'Betrag',
    },
    orderNumber: {
      en: 'Order No.',
      de: 'Auftrags-Nr.',
    },
    orderNumberMissing: {
      en: 'Order No. not set',
      de: 'Auftrags-Nr. nicht gesetzt',
    },
    customer: {
      en: 'Customer',
      de: 'Kunde',
    },
    customerMissing: {
      en: 'Customer not set',
      de: 'Kunde nicht gesetzt',
    },
    dealerStock: {
      en: 'Dealer stock',
      de: 'Händlerbestand',
    },
    unnamedLine: {
      en: 'Proposed line item',
      de: 'Vorgeschlagene Position',
    },
    vehicle: {
      en: 'Vehicle',
      de: 'Fahrzeug',
    },
    vehicleMissing: {
      en: 'Vehicle not set',
      de: 'Fahrzeug nicht gesetzt',
    },
    workshopOrderId: {
      en: 'Workshop order ID',
      de: 'Auftrags-ID',
    },
    proposedLines: {
      en: 'Proposed lines',
      de: 'Vorgeschlagene Positionen',
    },
    lineName: {
      en: 'Name',
      de: 'Bezeichnung',
    },
    lineType: {
      en: 'Type',
      de: 'Typ',
    },
    lineQuantity: {
      en: 'Qty',
      de: 'Menge',
    },
    lineUnitPrice: {
      en: 'Unit price',
      de: 'Einzelpreis',
    },
    lineTypePart: {
      en: 'Part',
      de: 'Teil',
    },
    lineTypeLabor: {
      en: 'Labor',
      de: 'Arbeit',
    },
    previewDiff: {
      en: 'Preview / Diff',
      de: 'Vorschau / Differenz',
    },
    payloadJson: {
      en: 'Payload JSON',
      de: 'Nutzlast-JSON',
    },
    traceId: {
      en: 'Trace ID',
      de: 'Trace-ID',
    },
    expiresAt: {
      en: 'Expires',
      de: 'Gültig bis',
    },
    payloadPreview: {
      en: 'Payload & Preview',
      de: 'Nutzlast & Vorschau',
    },
    showPreview: {
      en: 'Show details',
      de: 'Details anzeigen',
    },
    hidePreview: {
      en: 'Hide details',
      de: 'Details ausblenden',
    },
    actions: {
      en: 'Actions',
      de: 'Aktionen',
    },
    approve: {
      en: 'Approve',
      de: 'Genehmigen',
    },
    approving: {
      en: 'Approving...',
      de: 'Wird genehmigt...',
    },
    reject: {
      en: 'Reject',
      de: 'Ablehnen',
    },
    rejecting: {
      en: 'Rejecting...',
      de: 'Wird abgelehnt...',
    },
    doManually: {
      en: 'Do this manually',
      de: 'Manuell durchführen',
    },
    humanOnlyNotice: {
      en: 'This action is classified as HUMAN_ONLY and cannot be executed automatically. Please perform this action manually in the system.',
      de: 'Diese Aktion ist als HUMAN_ONLY eingestuft und kann nicht automatisiert ausgeführt werden. Bitte führen Sie diesen Vorgang manuell durch.',
    },
    emptyState: {
      en: 'No pending proposals',
      de: 'Keine ausstehenden Vorschläge',
    },
    emptyStateDesc: {
      en: 'All agent proposals have been processed. Great job!',
      de: 'Alle vorgeschlagenen Agenten-Aktionen wurden bearbeitet. Gute Arbeit!',
    },
    approveSuccess: {
      en: 'Proposal approved and executed successfully',
      de: 'Vorschlag erfolgreich genehmigt und ausgeführt',
    },
    rejectSuccess: {
      en: 'Proposal rejected',
      de: 'Vorschlag abgelehnt',
    },
    approveError: {
      en: 'Failed to approve proposal',
      de: 'Fehler beim Genehmigen des Vorschlags',
    },
    rejectError: {
      en: 'Failed to reject proposal',
      de: 'Fehler beim Ablehnen des Vorschlags',
    },
  },
  rejectDialog: {
    title: {
      en: 'Reject Agent Proposal',
      de: 'Agenten-Vorschlag ablehnen',
    },
    description: {
      en: 'Are you sure you want to reject this proposed action? The agent will not execute this payload.',
      de: 'Sind Sie sicher, dass Sie diese vorgeschlagene Aktion ablehnen möchten? Der Agent wird diese Nutzlast nicht ausführen.',
    },
    reasonLabel: {
      en: 'Reason (optional)',
      de: 'Begründung (optional)',
    },
    reasonPlaceholder: {
      en: 'e.g. Price too low, customer already notified, manual inspection needed...',
      de: 'z.B. Preis zu niedrig, Kunde bereits informiert, manuelle Prüfung erforderlich...',
    },
    cancel: {
      en: 'Cancel',
      de: 'Abbrechen',
    },
    confirm: {
      en: 'Confirm Rejection',
      de: 'Ablehnung bestätigen',
    },
  },
  activity: {
    filters: {
      statusLabel: {
        en: 'Status',
        de: 'Status',
      },
      allStatuses: {
        en: 'All statuses',
        de: 'Alle Status',
      },
      tierLabel: {
        en: 'Tier',
        de: 'Stufe',
      },
      allTiers: {
        en: 'All tiers',
        de: 'Alle Stufen',
      },
      agentPlaceholder: {
        en: 'Filter by agent name...',
        de: 'Nach Agenten filtern...',
      },
      startDateLabel: {
        en: 'From',
        de: 'Von',
      },
      endDateLabel: {
        en: 'To',
        de: 'Bis',
      },
    },
    columns: {
      time: {
        en: 'Time',
        de: 'Zeitpunkt',
      },
      agent: {
        en: 'Agent',
        de: 'Agent',
      },
      action: {
        en: 'Action',
        de: 'Aktion',
      },
      tier: {
        en: 'Tier',
        de: 'Stufe',
      },
      status: {
        en: 'Status',
        de: 'Status',
      },
      approver: {
        en: 'Decided by',
        de: 'Entschieden von',
      },
      traceId: {
        en: 'Trace ID',
        de: 'Trace-ID',
      },
    },
    emptyState: {
      en: 'No activity found',
      de: 'Keine Aktivitäten gefunden',
    },
    emptyStateDesc: {
      en: 'No agent action records match the selected filters.',
      de: 'Keine Agenten-Aktivitäten entsprechen den gewählten Filtern.',
    },
    loadMore: {
      en: 'Load more',
      de: 'Mehr laden',
    },
    loadingMore: {
      en: 'Loading more…',
      de: 'Weitere Einträge werden geladen…',
    },
    viewAudit: {
      en: 'View correlated audit logs',
      de: 'Korrelierte Audit-Logs anzeigen',
    },
  },
  decisionShadow: {
    description: {
      en: 'Read-only view of Jev suggestions recorded in shadow mode. Suggestions are never applied and do not change any outcome.',
      de: 'Nur-Lese-Ansicht der im Schattenmodus protokollierten Jev-Vorschläge. Vorschläge werden nie angewendet und ändern kein Ergebnis.',
    },
    filters: {
      useCaseLabel: {
        en: 'Use case',
        de: 'Anwendungsfall',
      },
      allUseCases: {
        en: 'All use cases',
        de: 'Alle Anwendungsfälle',
      },
    },
    useCases: {
      import_row_matching: {
        en: 'Import row matching',
        de: 'Import-Zeilenzuordnung',
      },
      document_sort: {
        en: 'Document sort',
        de: 'Dokumentensortierung',
      },
    },
    columns: {
      time: {
        en: 'Time',
        de: 'Zeitpunkt',
      },
      useCase: {
        en: 'Use case',
        de: 'Anwendungsfall',
      },
      suggestion: {
        en: 'Suggestion',
        de: 'Vorschlag',
      },
      actualOutcome: {
        en: 'Actual outcome',
        de: 'Tatsächliches Ergebnis',
      },
      match: {
        en: 'Match',
        de: 'Übereinstimmung',
      },
      latency: {
        en: 'Latency',
        de: 'Latenz',
      },
      provider: {
        en: 'Provider / model',
        de: 'Anbieter / Modell',
      },
      error: {
        en: 'Provider error',
        de: 'Anbieterfehler',
      },
      traceId: {
        en: 'Trace ID',
        de: 'Trace-ID',
      },
    },
    confidence: {
      en: 'Confidence',
      de: 'Konfidenz',
    },
    matchYes: {
      en: 'Match',
      de: 'Treffer',
    },
    matchNo: {
      en: 'Mismatch',
      de: 'Abweichung',
    },
    noSuggestion: {
      en: 'No suggestion',
      de: 'Kein Vorschlag',
    },
    emptyState: {
      en: 'No shadow suggestions found',
      de: 'Keine Schatten-Vorschläge gefunden',
    },
    emptyStateDesc: {
      en: 'No decision shadow rows match the selected filters.',
      de: 'Keine Einträge zur Entscheidungs-Schattenprotokollierung entsprechen den gewählten Filtern.',
    },
  },
  traceDialog: {
    title: {
      en: 'Trace Audit & Correlation',
      de: 'Trace-Audit & Korrelation',
    },
    description: {
      en: 'Review all actions and ADR-0015 audit log entries correlated with trace ID:',
      de: 'Übersicht aller Aktionen und ADR-0015-Audit-Einträge für Trace-ID:',
    },
    actionHistory: {
      en: 'Action Log Entries',
      de: 'Aktionsprotokoll-Einträge',
    },
    correlatedAudit: {
      en: 'Correlated System Audit Logs (ADR-0015)',
      de: 'Korrelierte System-Audit-Logs (ADR-0015)',
    },
    noAudit: {
      en: 'No correlated ADR-0015 audit records found for this trace.',
      de: 'Keine korrelierten ADR-0015-Audit-Einträge für diesen Trace gefunden.',
    },
    close: {
      en: 'Close',
      de: 'Schließen',
    },
  },
  common: {
    loading: {
      en: 'Loading data...',
      de: 'Daten werden geladen...',
    },
    error: {
      en: 'An error occurred while loading data.',
      de: 'Beim Laden der Daten ist ein Fehler aufgetreten.',
    },
    retry: {
      en: 'Retry',
      de: 'Erneut versuchen',
    },
  },
} as const
