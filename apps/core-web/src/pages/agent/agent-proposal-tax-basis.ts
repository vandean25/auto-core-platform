import type { AgentProposal } from '@/api/agent-proposals'

export type AmountTaxBasis = 'NET' | 'GROSS'

const PURCHASE_ORDER_PROPOSE_ACTION = 'purchase_order.propose_draft'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function mapPriceDisplay(
  value: unknown,
): AmountTaxBasis | null {
  if (value === 'GROSS') {
    return 'GROSS'
  }
  if (value === 'NET_WITH_VAT') {
    return 'NET'
  }
  return null
}

function readDocumentPriceDisplay(
  record: Record<string, unknown> | null | undefined,
): AmountTaxBasis | null {
  if (!record) {
    return null
  }
  const document = record.document
  if (!isRecord(document)) {
    return null
  }
  return mapPriceDisplay(document.price_display)
}

/** Purchase-order propose payloads store net unit costs on each line (MCP / REST). */
export function purchaseOrderPayloadUsesNetCostBasis(
  payload: Record<string, unknown>,
): boolean {
  const lines = payload.lines
  if (!Array.isArray(lines) || lines.length === 0) {
    return false
  }
  return lines.every(
    (line) =>
      isRecord(line) &&
      isRecord(line.cost_basis) &&
      typeof line.cost_basis.unit_cost_net === 'string',
  )
}

/**
 * Reads net/gross from fields the backend actually stores on agent proposals.
 * Does not infer from unit prices or workshop pricing rules.
 */
export function resolveProposalAmountTaxBasis(
  proposal: AgentProposal,
): AmountTaxBasis | null {
  const payload = (proposal.payload_json ?? {}) as Record<string, unknown>

  if (
    proposal.action_type === PURCHASE_ORDER_PROPOSE_ACTION &&
    purchaseOrderPayloadUsesNetCostBasis(payload)
  ) {
    return 'NET'
  }

  const fromPayloadDocument = readDocumentPriceDisplay(payload)
  if (fromPayloadDocument) {
    return fromPayloadDocument
  }

  const preview = (proposal.preview_json ?? null) as Record<string, unknown> | null
  if (!preview) {
    return null
  }

  const fromPreviewRoot = readDocumentPriceDisplay(preview)
  if (fromPreviewRoot) {
    return fromPreviewRoot
  }

  const nestedPreview = preview.preview
  if (isRecord(nestedPreview)) {
    return readDocumentPriceDisplay(nestedPreview)
  }

  return null
}

/** Workshop line amounts use the proposal-level basis (line payloads carry no basis flag). */
export function resolveLineAmountTaxBasis(
  proposal: AgentProposal,
): AmountTaxBasis | null {
  return resolveProposalAmountTaxBasis(proposal)
}
