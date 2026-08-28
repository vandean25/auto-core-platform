import { describe, expect, it } from 'vitest'
import { APP_ROUTE_PATHS, MECHANIC_ROUTE_PATHS, isKnownAppPath } from './app-route-paths'

describe('isKnownAppPath', () => {
  it('recognizes registered application routes', () => {
    expect(isKnownAppPath(APP_ROUTE_PATHS.dashboard)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.inventory)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.hrEmployees)).toBe(true)
    expect(isKnownAppPath(MECHANIC_ROUTE_PATHS.queue)).toBe(true)
    expect(isKnownAppPath('/workshop/orders/abc-123')).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.workshopPick)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.workshopPickList)).toBe(true)
  })

  it('rejects unknown routes', () => {
    expect(isKnownAppPath('/this-route-does-not-exist-qa')).toBe(false)
    expect(isKnownAppPath('/invoices')).toBe(false)
    expect(isKnownAppPath('/login')).toBe(false)
  })
})
