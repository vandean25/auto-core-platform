// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildWorkshopIntakePrefillHref,
  parseWorkshopIntakePrefillId,
  readWorkshopIntakePrefillFromSearch,
} from './workshop-intake-prefill'

const VEHICLE_ID = 'e0000000-0000-4000-8000-000000000002'
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000001'

describe('workshop intake prefill', () => {
  it('builds query params for customer and vehicle', () => {
    expect(
      buildWorkshopIntakePrefillHref({ customerId: CUSTOMER_ID, vehicleId: VEHICLE_ID }),
    ).toBe(`/workshop/intake?vehicleId=${VEHICLE_ID}&customerId=${CUSTOMER_ID}`)
    expect(buildWorkshopIntakePrefillHref({ customerId: CUSTOMER_ID })).toBe(
      `/workshop/intake?customerId=${CUSTOMER_ID}`,
    )
  })

  it('reads only UUID prefill params from the location search string', () => {
    expect(
      readWorkshopIntakePrefillFromSearch(`?customerId=${CUSTOMER_ID}&vehicleId=${VEHICLE_ID}`),
    ).toEqual({
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
    })
    expect(readWorkshopIntakePrefillFromSearch('?customerId=foo/bar&vehicleId=veh-1')).toEqual({})
    expect(readWorkshopIntakePrefillFromSearch('')).toEqual({})
  })

  it('rejects non-UUID ids', () => {
    expect(parseWorkshopIntakePrefillId('veh-1')).toBeUndefined()
    expect(parseWorkshopIntakePrefillId(CUSTOMER_ID)).toBe(CUSTOMER_ID)
  })
})
