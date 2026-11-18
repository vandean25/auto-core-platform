import { i18n } from '@/lib/i18n'
import {
  formatDefaultSupervisionChangeLabel,
  parseWouldChangeFromPreview,
  type ProposalWouldChange,
} from './agent-proposal-change-preview'

const NS = 'agent'

/** A changed customer or vehicle field of a proposal, with masked or plain values around it. */
export type CustomerProposalFieldChange = {
  field: string
  before_masked: string | null
  after_masked: string | null
  before?: string | null
  after?: string | null
  warning?: string | null
}

/** A customer change of a proposal, with the fields the proposal touches. */
export type CustomerSupervisionChange = ProposalWouldChange & {
  fields: CustomerProposalFieldChange[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const WARNING_I18N_KEYS: Record<string, string> = {
  'Mileage decreased compared to current recorded value':
    'changePreview.warnings.mileage_decrease',
}

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

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseDiffEntry(entry: unknown): CustomerProposalFieldChange | null {
  if (!isRecord(entry) || typeof entry.field !== 'string' || !entry.field) {
    return null
  }
  const parsed: CustomerProposalFieldChange = {
    field: entry.field,
    before_masked: optionalString(entry.before_masked),
    after_masked: optionalString(entry.after_masked),
  }
  if ('before' in entry) parsed.before = optionalString(entry.before)
  if ('after' in entry) parsed.after = optionalString(entry.after)
  const warning = optionalString(entry.warning)
  if (warning) parsed.warning = warning
  return parsed
}

/**
 * The masked field diff of a customer proposal (AUT-613) or plain field diff
 * of a vehicle proposal (AUT-614).
 */
export function parseCustomerProposalDiff(
  previewJson: unknown,
): CustomerProposalFieldChange[] {
  const raw = customerDiffOf(previewJson)
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map(parseDiffEntry)
    .filter((entry): entry is CustomerProposalFieldChange => entry !== null)
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

export function parseVehicleSupervisionChanges(
  previewJson: unknown,
): CustomerSupervisionChange[] {
  const fields = parseCustomerProposalDiff(previewJson)
  return parseWouldChangeFromPreview(previewJson)
    .filter((change) => change.entity === 'Vehicle')
    .map((change) => ({ ...change, fields }))
}

export function formatCustomerProposalFieldName(field: string): string {
  const key = `changePreview.fields.${field}`
  if (i18n.exists(key, { ns: NS })) {
    return String(i18n.t(key as never, { ns: NS }))
  }
  return field
}

export function formatProposalFieldWarning(warning: string): string {
  const key = WARNING_I18N_KEYS[warning]
  if (key && i18n.exists(key, { ns: NS })) {
    return String(i18n.t(key as never, { ns: NS }))
  }
  return warning
}

function formatPlainDiffValues(
  before: string | null,
  after: string | null,
): string | null {
  if (before !== null && after !== null) return `${before} → ${after}`
  if (after !== null) return after
  if (before !== null) return `${before} → —`
  return null
}

function formatFieldChangeItem(change: CustomerProposalFieldChange): string {
  const name = formatCustomerProposalFieldName(change.field)
  const hasPlainValues = 'before' in change || 'after' in change
  const transition = hasPlainValues
    ? formatPlainDiffValues(change.before ?? null, change.after ?? null)
    : null
  const text = transition ? `${name}: ${transition}` : name
  return change.warning
    ? `${text} — ${formatProposalFieldWarning(change.warning)}`
    : text
}

export function formatCustomerProposalFieldSummary(
  changes: CustomerProposalFieldChange[],
): string {
  return changes.map(formatFieldChangeItem).join(', ')
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
