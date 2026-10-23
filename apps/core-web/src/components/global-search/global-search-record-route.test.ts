// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseGlobalSearchRecordRef } from './global-search-record-route'

describe('parseGlobalSearchRecordRef', () => {
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

  it('ignores list routes and nested workshop paths', () => {
    expect(parseGlobalSearchRecordRef('/workshop/orders')).toBeNull()
    expect(parseGlobalSearchRecordRef('/workshop/orders/order-1/check-in')).toBeNull()
    expect(parseGlobalSearchRecordRef('/vehicles/pickerl-due')).toBeNull()
    expect(parseGlobalSearchRecordRef('/dashboard')).toBeNull()
  })
})
