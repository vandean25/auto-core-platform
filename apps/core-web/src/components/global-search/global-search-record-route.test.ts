// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseGlobalSearchRecordRef } from './global-search-record-route'

describe('parseGlobalSearchRecordRef', () => {
  it('reads tyre set detail routes but not the list or nested paths', () => {
    expect(parseGlobalSearchRecordRef('/workshop/tyre-storage/set-1')).toEqual({
      entity: 'tyre_set',
      id: 'set-1',
    })
    expect(parseGlobalSearchRecordRef('/workshop/tyre-storage')).toBeNull()
    expect(parseGlobalSearchRecordRef('/workshop/tyre-storage/set-1/events')).toBeNull()
  })

  it('reads workshop order, customer and vehicle detail routes', () => {
    expect(parseGlobalSearchRecordRef('/workshop/orders/order-1')).toEqual({
      entity: 'workshop_order',
      id: 'order-1',
    })
    expect(parseGlobalSearchRecordRef('/customers/cust-1')).toEqual({
      entity: 'customer',
      id: 'cust-1',
    })
    expect(parseGlobalSearchRecordRef('/vehicles/veh-1')).toEqual({
      entity: 'vehicle',
      id: 'veh-1',
    })
  })

  it('reads the focused estimate list row on the estimates list only', () => {
    expect(parseGlobalSearchRecordRef('/workshop/estimates', 'ver-1')).toEqual({ entity: 'estimate', id: 'ver-1' })
    expect(parseGlobalSearchRecordRef('/workshop/estimates', null)).toBeNull()
    expect(parseGlobalSearchRecordRef('/workshop/orders', 'ver-1')).toBeNull()
  })

  it('ignores list routes and nested workshop paths', () => {
    expect(parseGlobalSearchRecordRef('/workshop/orders')).toBeNull()
    expect(parseGlobalSearchRecordRef('/workshop/orders/order-1/check-in')).toBeNull()
    expect(parseGlobalSearchRecordRef('/vehicles/pickerl-due')).toBeNull()
    expect(parseGlobalSearchRecordRef('/dashboard')).toBeNull()
  })
})
