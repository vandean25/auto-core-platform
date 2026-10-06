import { describe, expect, expectTypeOf, it } from 'vitest'
import type { NovaCalculateRequest } from './nova'

type IsAssignable<From, To> = [From] extends [To] ? true : false

describe('NovaCalculateRequest', () => {
  it('accepts both documented modes and rejects incomplete explicit inputs', () => {
    const vehicleRequest: NovaCalculateRequest = {
      vehicleId: 'vehicle-1',
      netPriceEuro: 10000,
    }

    const explicitRequest: NovaCalculateRequest = {
      netPriceEuro: 10000,
      emissionCycle: 'WLTP',
      driveType: 'ICE',
      taxableEventDate: '2025-03-01',
    }

    const incompleteRequestIsRejected: IsAssignable<
      { netPriceEuro: number },
      NovaCalculateRequest
    > = false

    expectTypeOf(vehicleRequest).toMatchTypeOf<NovaCalculateRequest>()
    expectTypeOf(explicitRequest).toMatchTypeOf<NovaCalculateRequest>()
    expect(incompleteRequestIsRejected).toBe(false)
  })
})
