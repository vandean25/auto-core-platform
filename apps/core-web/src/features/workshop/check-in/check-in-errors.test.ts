import { describe, expect, it } from 'vitest'
import deWorkshop from '../../../../../../locales/de/workshop.json'
import { describeWorkshopCheckInError } from './check-in-errors'

describe('describeWorkshopCheckInError', () => {
  it('maps CHECK_IN_COMPLETED to the German workshop string', () => {
    const message = describeWorkshopCheckInError({
      data: { code: 'CHECK_IN_COMPLETED' },
    })
    expect(message).toBe(deWorkshop.checkIn.errors.CHECK_IN_COMPLETED)
  })

  it('falls back to generic copy for unknown errors', () => {
    const message = describeWorkshopCheckInError(new Error('network'))
    expect(message).toBe(deWorkshop.checkIn.errors.generic)
  })
})
