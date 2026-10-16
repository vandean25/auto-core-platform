import type { Language } from './agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from './agent-supervision-copy'

export type ProposalWouldChange = {
  entity: string
  id: string
  op: 'create' | 'update' | 'delete'
  provisional?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeOp = (value: unknown): ProposalWouldChange['op'] | null => {
  if (value === 'create' || value === 'update' || value === 'delete') {
    return value
  }
  return null
}

/** Reads `would_change` rows from proposal `preview_json` (MCP / dry-run shape). */
export function parseWouldChangeFromPreview(
  previewJson: unknown,
): ProposalWouldChange[] {
  if (!isRecord(previewJson) || !Array.isArray(previewJson.would_change)) {
    return []
  }

  const changes: ProposalWouldChange[] = []
  for (const raw of previewJson.would_change) {
    if (!isRecord(raw)) continue
    const entity = typeof raw.entity === 'string' ? raw.entity : null
    const op = normalizeOp(raw.op ?? raw.type)
    const id =
      typeof raw.id === 'string'
        ? raw.id
        : raw.id === null || raw.id === undefined
          ? ''
          : String(raw.id)
    if (!entity || !op) continue
    changes.push({
      entity,
      id,
      op,
      provisional:
        typeof raw.provisional === 'boolean' ? raw.provisional : undefined,
    })
  }
  return changes
}

/** Internal bookkeeping (e.g. site id on simulation) — not a business change for supervisors. */
export function isInternalSupervisionChange(change: ProposalWouldChange): boolean {
  return change.entity === 'Site' && change.op === 'update'
}

export function getDefaultSupervisionChanges(
  changes: ProposalWouldChange[],
): ProposalWouldChange[] {
  return changes.filter((change) => !isInternalSupervisionChange(change))
}

const OP_VERB: Record<
  ProposalWouldChange['op'],
  { en: string; de: string }
> = {
  create: { en: 'Create', de: 'Anlegen' },
  update: { en: 'Update', de: 'Aktualisieren' },
  delete: { en: 'Delete', de: 'Löschen' },
}

const ENTITY_LABELS: Record<string, { en: string; de: string }> = {
  Site: SUPERVISION_COPY.approvals.workshopLocation,
  WorkshopOrder: { en: 'Workshop order', de: 'Werkstattauftrag' },
  WorkshopTask: { en: 'Workshop task', de: 'Werkstattaufgabe' },
  WorkshopTaskLineItem: {
    en: 'Workshop line item',
    de: 'Werkstattposition',
  },
  Customer: { en: 'Customer', de: 'Kunde' },
  SalesOrder: { en: 'Sales order', de: 'Verkaufsauftrag' },
}

function entityLabel(entity: string, language: Language): string {
  const known = ENTITY_LABELS[entity]
  if (known) return getCopy(known, language)
  const spaced = entity.replace(/([a-z])([A-Z])/g, '$1 $2')
  return spaced
}

/** Human-readable line for the default change preview (excludes internal rows). */
export function formatDefaultSupervisionChangeLabel(
  change: ProposalWouldChange,
  language: Language = 'en',
): string {
  const verb = getCopy(OP_VERB[change.op], language)
  return `${entityLabel(change.entity, language)} — ${verb}`
}

/** Label for Show details, including internal rows in workshop language. */
export function formatDetailSupervisionChangeLabel(
  change: ProposalWouldChange,
  language: Language = 'en',
): string {
  if (isInternalSupervisionChange(change)) {
    return getCopy(SUPERVISION_COPY.approvals.workshopLocation, language)
  }
  return formatDefaultSupervisionChangeLabel(change, language)
}
