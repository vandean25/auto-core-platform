// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { wireCodeForHttpStatus } from './http-status-fallback-codes'

describe('wireCodeForHttpStatus', () => {
  it('maps common client error statuses', () => {
    expect(wireCodeForHttpStatus(413)).toBe('HTTP_413')
    expect(wireCodeForHttpStatus(415)).toBe('HTTP_415')
  })

  it('uses HTTP_4XX for other 4xx statuses', () => {
    expect(wireCodeForHttpStatus(410)).toBe('HTTP_4XX')
    expect(wireCodeForHttpStatus(418)).toBe('HTTP_4XX')
  })

  it('reserves HTTP_500 for 5xx without an explicit mapping', () => {
    expect(wireCodeForHttpStatus(599)).toBe('HTTP_500')
  })
})
