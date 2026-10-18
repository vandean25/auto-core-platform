import { i18n } from '@/lib/i18n'

const NS = 'agent'

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

export function isInternalSupervisionChange(change: ProposalWouldChange): boolean {
  return change.entity === 'Site' && change.op === 'update'
}

export function getDefaultSupervisionChanges(
  changes: ProposalWouldChange[],
): ProposalWouldChange[] {
  return changes.filter((change) => !isInternalSupervisionChange(change))
}

function entityLabel(entity: string): string {
  const key = `changePreview.entities.${entity}`
  if (i18n.exists(key, { ns: NS })) {
    return String(i18n.t(key as never, { ns: NS }))
  }
  return entity.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function formatDefaultSupervisionChangeLabel(
  change: ProposalWouldChange,
): string {
  const verb = String(i18n.t(`changePreview.ops.${change.op}` as never, { ns: NS }))
  return `${entityLabel(change.entity)} — ${verb}`
}

export function formatDetailSupervisionChangeLabel(
  change: ProposalWouldChange,
): string {
  if (isInternalSupervisionChange(change)) {
    return i18n.t('approvals.workshopLocation', { ns: NS })
  }
  return formatDefaultSupervisionChangeLabel(change)
}
