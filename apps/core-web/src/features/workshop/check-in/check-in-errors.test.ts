import { describe, expect, it } from 'vitest'
import deWorkshop from '../../../../../../locales/de/workshop.json'
import {
  createCheckInHttpError,
  describeWorkshopCheckInError,
} from './check-in-errors'

describe('describeWorkshopCheckInError', () => {
  it('maps CHECK_IN_COMPLETED from createCheckInHttpError to the German string', () => {
    const error = createCheckInHttpError(
      { status: 409 } as Response,
      { code: 'CHECK_IN_COMPLETED', message: 'done' },
    )
    expect(describeWorkshopCheckInError(error)).toBe(
      deWorkshop.checkIn.errors.CHECK_IN_COMPLETED,
    )
  })

  it('reads CHECK_IN_CONFLICT from error.data', () => {
    expect(
      describeWorkshopCheckInError({
        data: { code: 'CHECK_IN_CONFLICT' },
      }),
    ).toBe(deWorkshop.checkIn.errors.CHECK_IN_CONFLICT)
  })

  it('maps CHECK_IN_MEDIA_INVALID from createCheckInHttpError', () => {
    const error = createCheckInHttpError(
      { status: 422 } as Response,
      { code: 'CHECK_IN_MEDIA_INVALID', message: 'invalid media' },
    )
    expect(describeWorkshopCheckInError(error)).toBe(
      deWorkshop.checkIn.errors.CHECK_IN_MEDIA_INVALID,
    )
  })

  it('falls back to generic copy for unknown errors', () => {
    const message = describeWorkshopCheckInError(new Error('network'))
    expect(message).toBe(deWorkshop.checkIn.errors.generic)
  })
})
