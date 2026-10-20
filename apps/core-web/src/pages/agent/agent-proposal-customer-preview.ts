import { i18n } from '@/lib/i18n'
import {
  formatDefaultSupervisionChangeLabel,
  parseWouldChangeFromPreview,
  type ProposalWouldChange,
} from './agent-proposal-change-preview'

const NS = 'agent'

/** A changed customer field of a proposal, with the masked values around it. */
export type CustomerProposalFieldChange = {
  field: string
  before_masked: string | null
  after_masked: string | null
}

/** A customer change of a proposal, with the fields the proposal touches. */
export type CustomerSupervisionChange = ProposalWouldChange & {
  fields: CustomerProposalFieldChange[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The masked field diff of a customer proposal (AUT-613). A stored proposal
 * carries the diff in `result`, an MCP write result in `preview`.
 */
function customerDiffOf(previewJson: unknown): unknown {
  if (!isRecord(previewJson)) {
    return null
  }
  for (const key of ['result', 'preview']) {
    const section = previewJson[key]
    if (isRecord(section) && Array.isArray(section.diff)) {
      return section.diff
    }
  }
  return null
}

/**
 * The masked field diff of a customer proposal (AUT-613). The proposal preview
 * carries it, so the approver can see which customer fields change.
 */
export function parseCustomerProposalDiff(
  previewJson: unknown,
): CustomerProposalFieldChange[] {
  const raw = customerDiffOf(previewJson)
  if (!Array.isArray(raw)) {
    return []
  }

  const changes: CustomerProposalFieldChange[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const field = typeof entry.field === 'string' ? entry.field : null
    if (!field) continue
    changes.push({
      field,
      before_masked:
        typeof entry.before_masked === 'string' ? entry.before_masked : null,
      after_masked:
        typeof entry.after_masked === 'string' ? entry.after_masked : null,
    })
  }
  return changes
}

/**
 * The customer changes of a proposal preview, each with the fields it touches.
 */
export function parseCustomerSupervisionChanges(
  previewJson: unknown,
): CustomerSupervisionChange[] {
  const fields = parseCustomerProposalDiff(previewJson)
  return parseWouldChangeFromPreview(previewJson)
    .filter((change) => change.entity === 'Customer')
    .map((change) => ({ ...change, fields }))
}

export function formatCustomerProposalFieldName(field: string): string {
  const key = `changePreview.fields.${field}`
  if (i18n.exists(key, { ns: NS })) {
    return String(i18n.t(key as never, { ns: NS }))
  }
  return field
}

export function formatCustomerProposalFieldSummary(
  changes: CustomerProposalFieldChange[],
): string {
  return changes
    .map((change) => formatCustomerProposalFieldName(change.field))
    .join(', ')
}

/**
 * The label of a customer change on the supervision card: the change itself
 * and the customer fields it touches.
 */
export function formatCustomerSupervisionChangeLabel(
  change: CustomerSupervisionChange,
): string {
  const label = formatDefaultSupervisionChangeLabel(change)
  if (change.fields.length === 0) {
    return label
  }
  return `${label} (${formatCustomerProposalFieldSummary(change.fields)})`
}
