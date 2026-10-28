import { describe, expect, it } from 'vitest'
import { getBadRequestFields } from './api-error'

const badRequest = (message: unknown) => ({ status: 400, data: { statusCode: 400, message, code: 'HTTP_400' } })

describe('getBadRequestFields', () => {
  it('names the fields a 400 refused, once each', () => {
    expect(
      getBadRequestFields(badRequest(['email must be an email', 'first_name must be a string', 'email should not be empty'])),
    ).toEqual(['email', 'first_name'])
  })

  it('knows nothing about a message that is plain text or an error without a body', () => {
    expect(getBadRequestFields(badRequest('Customer not found'))).toEqual([])
    expect(getBadRequestFields(new Error('offline'))).toEqual([])
    expect(getBadRequestFields(undefined)).toEqual([])
  })
})
