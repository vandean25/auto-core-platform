import { describe, expect, it } from 'vitest'
import { APP_ROUTE_PATHS, LOGIN_PATH, MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import {
  APP_DOCUMENT_TITLE,
  NOT_FOUND_SECTION_TITLE,
  ROUTE_SECTION_TITLES,
  formatDocumentTitle,
  getRouteDocumentTitle,
  getRouteSectionTitle,
  matchRoutePattern,
} from '@/lib/document-title'

/** Replaces each `:param` segment so a route pattern becomes a concrete pathname. */
function samplePathFor(pattern: string) {
  return pattern.replace(/:[^/]+/g, 'sample-id')
}

describe('formatDocumentTitle', () => {
  it('appends the app name to a section title', () => {
    expect(formatDocumentTitle(['Customers'])).toBe('Customers - Auto Core')
  })

  it('orders entity, then section, then the app name', () => {
    expect(formatDocumentTitle(['WO-2026-0002', 'Workshop Orders'])).toBe(
      'WO-2026-0002 - Workshop Orders - Auto Core',
    )
  })

  it('skips missing and blank parts', () => {
    expect(formatDocumentTitle([null, undefined, '  ', 'Dashboard'])).toBe('Dashboard - Auto Core')
  })

  it('falls back to the app name when there are no parts', () => {
    expect(formatDocumentTitle([])).toBe(APP_DOCUMENT_TITLE)
  })
})

describe('route title table', () => {
  const routePatterns = [
    ...Object.values(APP_ROUTE_PATHS),
    ...Object.values(MECHANIC_ROUTE_PATHS),
    LOGIN_PATH,
  ]

  it('has exactly one entry per route constant in app-route-paths', () => {
    expect(Object.keys(ROUTE_SECTION_TITLES).sort()).toEqual([...routePatterns].sort())
  })

  it.each(Object.entries(ROUTE_SECTION_TITLES))(
    'resolves %s to itself and titles it "%s"',
    (pattern, title) => {
      const pathname = samplePathFor(pattern)

      expect(matchRoutePattern(pathname)).toBe(pattern)
      expect(getRouteSectionTitle(pathname)).toBe(title)
    },
  )

  it('prefers a static route over a dynamic route with the same shape', () => {
    expect(getRouteSectionTitle('/vehicles/pickerl-due')).toBe('Pickerl fällig')
    expect(getRouteSectionTitle('/vehicles/42')).toBe('Vehicles')
  })

  it('returns the not-found title for unknown paths', () => {
    expect(matchRoutePattern('/no-such-page')).toBeNull()
    expect(getRouteSectionTitle('/no-such-page')).toBe(NOT_FOUND_SECTION_TITLE)
  })

  it('builds the full document title for a route', () => {
    expect(getRouteDocumentTitle('/customers')).toBe('Customers - Auto Core')
    expect(getRouteDocumentTitle('/workshop/orders')).toBe('Workshop Orders - Auto Core')
    expect(getRouteDocumentTitle('/dashboard')).toBe('Dashboard - Auto Core')
    expect(getRouteDocumentTitle('/no-such-page')).toBe('Page not found - Auto Core')
  })
})
