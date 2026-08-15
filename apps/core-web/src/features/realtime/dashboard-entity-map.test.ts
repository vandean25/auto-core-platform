import { describe, expect, it } from 'vitest'
import { getDashboardSourceKeysForEntityType, isEntityUpdatedPayload } from '@/features/realtime/dashboard-entity-map'

describe('dashboard realtime entity mapping', () => {
  it('maps backend entity types to dashboard source keys', () => {
    expect(getDashboardSourceKeysForEntityType('PURCHASE_ORDER')).toEqual(['purchase-orders'])
    expect(getDashboardSourceKeysForEntityType('WORKSHOP_ORDER')).toEqual(['workshop-orders'])
    expect(getDashboardSourceKeysForEntityType('CATALOG_ITEM')).toEqual(['inventory'])
    expect(getDashboardSourceKeysForEntityType('VEHICLE')).toEqual(['vehicles', 'vehicle-stock'])
    expect(getDashboardSourceKeysForEntityType('VEHICLE_PURCHASE')).toEqual(['vehicle-stock'])
    expect(getDashboardSourceKeysForEntityType('VEHICLE_SALE')).toEqual(['vehicle-stock'])
  })

  it('validates entity_updated payload shape', () => {
    expect(
      isEntityUpdatedPayload({
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'abc',
        timestamp: '2026-03-09T17:00:00.000Z',
      }),
    ).toBe(true)

    expect(
      isEntityUpdatedPayload({
        type: 'NOT_REAL',
        action: 'UPDATED',
      }),
    ).toBe(false)

    expect(
      isEntityUpdatedPayload({
        type: 'PURCHASE_ORDER',
        action: 'INVALID',
      }),
    ).toBe(false)

    expect(
      isEntityUpdatedPayload({
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'abc',
        // missing timestamp
      }),
    ).toBe(false)

    expect(isEntityUpdatedPayload(null)).toBe(false)
    expect(isEntityUpdatedPayload(undefined)).toBe(false)
  })
})
