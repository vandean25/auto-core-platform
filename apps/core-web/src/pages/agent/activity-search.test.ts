import { describe, expect, it } from 'vitest'
import { parseActivityActionOrTraceSearch } from './activity-search'

describe('parseActivityActionOrTraceSearch', () => {
  it('returns empty filters for blank input', () => {
    expect(parseActivityActionOrTraceSearch('')).toEqual({})
    expect(parseActivityActionOrTraceSearch('   ')).toEqual({})
  })

  it('maps a full UUID to traceId', () => {
    const traceId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'
    expect(parseActivityActionOrTraceSearch(traceId)).toEqual({ traceId })
  })

  it('maps tool or action text to actionType', () => {
    expect(parseActivityActionOrTraceSearch('draft_workshop_order')).toEqual({
      actionType: 'draft_workshop_order',
    })
    expect(parseActivityActionOrTraceSearch('sales_order.apply_discount')).toEqual(
      {
        actionType: 'sales_order.apply_discount',
      },
    )
  })
})
