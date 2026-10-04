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
    viewAudit: {
      en: 'View correlated audit logs',
      de: 'Korrelierte Audit-Logs anzeigen',
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
