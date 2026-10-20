// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import {
  formatCustomerProposalFieldName,
  formatCustomerProposalFieldSummary,
  formatCustomerSupervisionChangeLabel,
  parseCustomerProposalDiff,
  parseCustomerSupervisionChanges,
} from './agent-proposal-customer-preview'

describe('agent-proposal-customer-preview', () => {
  const customerPreview = {
    would_change: [
      {
        entity: 'Customer',
        id: 'customer-1',
        op: 'update',
        provisional: true,
      },
    ],
    result: {
      entity: 'Customer',
      op: 'update',
      diff: [
        {
          field: 'email',
          before_masked: 'm***@example.at',
          after_masked: 'n***@example.at',
        },
        { field: 'address.zip', before_masked: '***', after_masked: '***' },
      ],
    },
  }

  beforeAll(async () => {
    await ensureNamespaceLoaded('agent')
    await changeUiLanguage('de')
  })

  it('parses the masked field diff of a customer proposal', () => {
    expect(parseCustomerProposalDiff(customerPreview)).toEqual([
      {
        field: 'email',
        before_masked: 'm***@example.at',
        after_masked: 'n***@example.at',
      },
      { field: 'address.zip', before_masked: '***', after_masked: '***' },
    ])
  })

  it('parses the field diff of an MCP write result', () => {
    expect(
      parseCustomerProposalDiff({ preview: customerPreview.result }),
    ).toHaveLength(2)
  })

  it('returns no diff for a proposal without a customer preview', () => {
    expect(parseCustomerProposalDiff({ would_change: [] })).toEqual([])
    expect(parseCustomerProposalDiff(undefined)).toEqual([])
  })

  it('collects the customer changes of a proposal with their fields', () => {
    const changes = parseCustomerSupervisionChanges(customerPreview)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      entity: 'Customer',
      id: 'customer-1',
      op: 'update',
    })
    expect(changes[0]?.fields).toHaveLength(2)
  })

  it('shows the changed customer fields in the supervision card label', () => {
    const changes = parseCustomerSupervisionChanges(customerPreview)

    expect(formatCustomerSupervisionChangeLabel(changes[0]!)).toContain(
      'E-Mail-Adresse',
    )
    expect(formatCustomerSupervisionChangeLabel(changes[0]!)).toContain('PLZ')
  })

  it('translates the customer field names', () => {
    expect(formatCustomerProposalFieldName('email')).toBe('E-Mail-Adresse')
    expect(formatCustomerProposalFieldName('address.zip')).toBe('PLZ')
    expect(formatCustomerProposalFieldName('unknown_field')).toBe(
      'unknown_field',
    )
  })

  it('lists the changed fields for the approver', () => {
    const summary = formatCustomerProposalFieldSummary(
      parseCustomerProposalDiff(customerPreview),
    )

    expect(summary).toBe('E-Mail-Adresse, PLZ')
  })
})
