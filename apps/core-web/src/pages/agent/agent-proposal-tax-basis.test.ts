import { describe, expect, it } from 'vitest'
import type { AgentProposal } from '@/api/agent-proposals'
import { resolveProposalAmountTaxBasis } from './agent-proposal-tax-basis'

const baseProposal = (): AgentProposal =>
  ({
    id: 'a1111111-1111-4111-8111-111111111101',
    tenant_id: 'tenant-1',
    trace_id: 'b2222222-2222-4222-8222-222222222202',
    action_type: 'workshop_order.propose_line',
    tier: 'PROPOSE',
    status: 'PENDING',
    payload_json: {},
    effective_summary: {
      target_type: 'WorkshopOrder',
      target_id: 'c3333333-3333-4333-8333-333333333303',
      amount_eur: 100,
    },
    workshop_order_summary: null,
    preview_json: null,
    created_by_agent: 'agent-1',
    decided_by: null,
    decided_by_name: null,
    decided_by_email: null,
    decided_at: null,
    reason: null,
    expires_at: '2026-10-11T12:00:00.000Z',
    created_at: '2026-10-04T12:00:00.000Z',
    updated_at: '2026-10-04T12:00:00.000Z',
  }) as AgentProposal

describe('resolveProposalAmountTaxBasis', () => {
  it('returns GROSS when amount_tax_basis is set on the payload', () => {
    const proposal = baseProposal()
    proposal.payload_json = { amount_tax_basis: 'GROSS' }
    expect(resolveProposalAmountTaxBasis(proposal)).toBe('GROSS')
  })

  it('returns null when no tax basis flag is present', () => {
    expect(resolveProposalAmountTaxBasis(baseProposal())).toBeNull()
  })

  it('reads amount_tax_basis from effective_summary when present', () => {
    const proposal = baseProposal()
    ;(proposal.effective_summary as { amount_tax_basis?: string }).amount_tax_basis =
      'NET'
    expect(resolveProposalAmountTaxBasis(proposal)).toBe('NET')
  })
})
