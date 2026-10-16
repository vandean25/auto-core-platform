import { describe, expect, it } from 'vitest'
import type { AgentProposal } from '@/api/agent-proposals'
import {
  purchaseOrderPayloadUsesNetCostBasis,
  resolveProposalAmountTaxBasis,
} from './agent-proposal-tax-basis'

const baseProposal = (overrides: Partial<AgentProposal> = {}): AgentProposal =>
  ({
    id: 'a1111111-1111-4111-8111-111111111101',
    tenant_id: 'tenant-1',
    trace_id: 'b2222222-2222-4222-8222-222222222202',
    action_type: 'workshop_order.propose_line',
    tier: 'PROPOSE',
    status: 'PENDING',
    payload_json: {
      workshop_order_id: 'c3333333-3333-4333-8333-333333333303',
      workshop_task_id: 'd4444444-4444-4444-8444-444444444404',
      expected_line_items_version: 0,
      line_item: {
        type: 'PART',
        item_no: 'SKU-001',
        description: 'Line item 001',
        quantity: 1,
        unit_price_cents: 10000,
      },
    },
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
    ...overrides,
  }) as AgentProposal

describe('purchaseOrderPayloadUsesNetCostBasis', () => {
  it('matches the MCP purchase_order.propose_draft line shape', () => {
    expect(
      purchaseOrderPayloadUsesNetCostBasis({
        vendor_id: '00000000-0000-4000-8000-000000000010',
        requisition_id: '00000000-0000-4000-8000-000000000011',
        lines: [
          {
            reservation_id: '00000000-0000-4000-8000-000000000012',
            catalog_item_id: '00000000-0000-4000-8000-000000000013',
            cost_basis: { version: 1, unit_cost_net: '10.00' },
          },
        ],
      }),
    ).toBe(true)
  })
})

describe('resolveProposalAmountTaxBasis', () => {
  it('returns NET for purchase_order.propose_draft with unit_cost_net lines', () => {
    const proposal = baseProposal({
      action_type: 'purchase_order.propose_draft',
      payload_json: {
        vendor_id: '00000000-0000-4000-8000-000000000010',
        requisition_id: '00000000-0000-4000-8000-000000000011',
        lines: [
          {
            reservation_id: '00000000-0000-4000-8000-000000000012',
            catalog_item_id: '00000000-0000-4000-8000-000000000013',
            cost_basis: { version: 1, unit_cost_net: '3.50' },
          },
        ],
      },
    })
    expect(resolveProposalAmountTaxBasis(proposal)).toBe('NET')
  })

  it('maps document.price_display GROSS from preview_json.preview', () => {
    const proposal = baseProposal({
      preview_json: {
        payload: {},
        would_change: [],
        provisional: true,
        preview: {
          document: {
            price_display: 'GROSS',
          },
        },
      },
    })
    expect(resolveProposalAmountTaxBasis(proposal)).toBe('GROSS')
  })

  it('maps document.price_display NET_WITH_VAT to net', () => {
    const proposal = baseProposal({
      preview_json: {
        preview: {
          document: {
            price_display: 'NET_WITH_VAT',
          },
        },
      },
    })
    expect(resolveProposalAmountTaxBasis(proposal)).toBe('NET')
  })

  it('returns null for workshop_order.propose_line without a stored basis', () => {
    expect(resolveProposalAmountTaxBasis(baseProposal())).toBeNull()
  })
})
