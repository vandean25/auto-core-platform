// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildWorkshopIntakePrefillHref, readWorkshopIntakePrefillFromSearch } from './workshop-intake-prefill'

describe('workshop intake prefill', () => {
  it('builds query params for customer and vehicle', () => {
    expect(
      buildWorkshopIntakePrefillHref({ customerId: 'cust-1', vehicleId: 'veh-1' }),
    ).toBe('/workshop/intake?vehicleId=veh-1&customerId=cust-1')
    expect(buildWorkshopIntakePrefillHref({ customerId: 'cust-1' })).toBe(
      '/workshop/intake?customerId=cust-1',
    )
  })

  it('reads prefill params from the location search string', () => {
    expect(readWorkshopIntakePrefillFromSearch('?customerId=cust-1&vehicleId=veh-1')).toEqual({
      customerId: 'cust-1',
      vehicleId: 'veh-1',
    })
    expect(readWorkshopIntakePrefillFromSearch('')).toEqual({})
  })
})
