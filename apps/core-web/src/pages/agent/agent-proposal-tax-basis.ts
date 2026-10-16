import type { AgentProposal } from '@/api/agent-proposals'

export type AmountTaxBasis = 'NET' | 'GROSS'

const TAX_BASIS_KEYS = [
  'amount_tax_basis',
  'tax_basis',
  'amountTaxBasis',
  'taxBasis',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function normalizeTaxBasis(value: unknown): AmountTaxBasis | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toUpperCase()
  if (normalized === 'NET' || normalized === 'NET_WITH_VAT') {
    return 'NET'
  }
  if (normalized === 'GROSS') {
    return 'GROSS'
  }
  return null
}

function readTaxBasisFromRecord(
  record: Record<string, unknown> | null | undefined,
): AmountTaxBasis | null {
  if (!record) {
    return null
  }
  for (const key of TAX_BASIS_KEYS) {
    const basis = normalizeTaxBasis(record[key])
    if (basis) {
      return basis
    }
  }
  if (isRecord(record.line_item)) {
    return readTaxBasisFromRecord(record.line_item)
  }
  if (isRecord(record.context)) {
    return readTaxBasisFromRecord(record.context)
  }
  return null
}

/** Reads net/gross basis from the proposal summary, payload, or preview (no inference). */
export function resolveProposalAmountTaxBasis(
  proposal: AgentProposal,
): AmountTaxBasis | null {
  const summary = proposal.effective_summary as
    | { amount_tax_basis?: unknown }
    | undefined
  const fromSummary = normalizeTaxBasis(summary?.amount_tax_basis)
  if (fromSummary) {
    return fromSummary
  }

  const payload = (proposal.payload_json ?? {}) as Record<string, unknown>
  const fromPayload = readTaxBasisFromRecord(payload)
  if (fromPayload) {
    return fromPayload
  }

  const preview = (proposal.preview_json ?? null) as Record<string, unknown> | null
  return readTaxBasisFromRecord(preview)
}

/** Line-level basis when present on the line payload; otherwise the proposal-level basis. */
export function resolveLineAmountTaxBasis(
  proposal: AgentProposal,
  linePayload: Record<string, unknown>,
): AmountTaxBasis | null {
  return (
    readTaxBasisFromRecord(linePayload) ??
    resolveProposalAmountTaxBasis(proposal)
  )
}
