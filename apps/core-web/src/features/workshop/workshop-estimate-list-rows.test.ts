import { describe, expect, it } from 'vitest'

import type { WorkshopEstimateListRow } from '@/api/workshop-estimates'
import { filterEstimateRows, sortEstimateRows } from './workshop-estimate-list-rows'

function row(overrides: Partial<WorkshopEstimateListRow>): WorkshopEstimateListRow {
  return {
    version_id: 'v-1',
    estimate_number: 'KV-2026-0001',
    version: 1,
    status: 'SENT',
    order_id: 'o-1',
    order_number: 'WO-1',
    customer_id: 'c-1',
    customer_name: 'Müller GmbH',
    vehicle_plate: 'W-123AB',
    sent_at: '2026-10-01T08:00:00.000Z',
    valid_until: '2026-10-15T08:00:00.000Z',
    decided_at: null,
    total_gross: '120.00',
    ...overrides,
  }
}

const label = (status: string) => status

describe('filterEstimateRows', () => {
  const rows = [row({}), row({ version_id: 'v-2', estimate_number: 'KV-2026-0002', customer_name: null, vehicle_plate: 'G-9XY' })]

  it('matches number, work order, customer and plate regardless of case', () => {
    expect(filterEstimateRows(rows, 'MÜLLER', label)).toHaveLength(1)
    expect(filterEstimateRows(rows, '0002', label)).toHaveLength(1)
    expect(filterEstimateRows(rows, 'g-9', label)).toHaveLength(1)
    expect(filterEstimateRows(rows, 'wo-1', label)).toHaveLength(2)
  })

  it('returns everything for an empty search', () => {
    expect(filterEstimateRows(rows, '  ', label)).toBe(rows)
  })
})

describe('sortEstimateRows', () => {
  const rows = [
    row({ version_id: 'a', total_gross: '9.00', sent_at: null }),
    row({ version_id: 'b', total_gross: '100.00', sent_at: '2026-10-02T08:00:00.000Z' }),
    row({ version_id: 'c', total_gross: '25.00', sent_at: '2026-10-01T08:00:00.000Z' }),
  ]

  it('sorts amounts as numbers', () => {
    expect(sortEstimateRows(rows, 'total_gross', 'asc').map((r) => r.version_id)).toEqual(['a', 'c', 'b'])
    expect(sortEstimateRows(rows, 'total_gross', 'desc').map((r) => r.version_id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps empty values last in both directions', () => {
    expect(sortEstimateRows(rows, 'sent_at', 'asc').map((r) => r.version_id)).toEqual(['c', 'b', 'a'])
    expect(sortEstimateRows(rows, 'sent_at', 'desc').map((r) => r.version_id)).toEqual(['b', 'c', 'a'])
  })

  it('leaves the order alone for an unknown or missing field', () => {
    expect(sortEstimateRows(rows, undefined, undefined)).toBe(rows)
    expect(sortEstimateRows(rows, 'nope', 'asc')).toBe(rows)
  })
})
