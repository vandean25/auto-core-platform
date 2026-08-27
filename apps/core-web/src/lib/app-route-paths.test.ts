import { describe, expect, it } from 'vitest'
import { isKnownAppPath } from './app-route-paths'

describe('isKnownAppPath', () => {
  it('recognizes registered application routes', () => {
    expect(isKnownAppPath('/dashboard')).toBe(true)
    expect(isKnownAppPath('/inventory')).toBe(true)
    expect(isKnownAppPath('/hr/employees')).toBe(true)
    expect(isKnownAppPath('/mechanic/queue')).toBe(true)
    expect(isKnownAppPath('/workshop/orders/abc-123')).toBe(true)
  })

  it('rejects unknown routes', () => {
    expect(isKnownAppPath('/this-route-does-not-exist-qa')).toBe(false)
    expect(isKnownAppPath('/login')).toBe(false)
  })
})
