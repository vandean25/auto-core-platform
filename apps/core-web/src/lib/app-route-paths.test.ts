// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { A11Y_FULLSTACK_ROUTE_PATHS } from '../../e2e-fullstack/a11y-checkpoint-paths'
import { A11Y_SMOKE_ROUTE_PATHS } from '../../e2e/utils/a11y-smoke-route-paths'
import { APP_ROUTE_PATHS, MECHANIC_ROUTE_PATHS, isKnownAppPath } from './app-route-paths'

const KNOWN_ROUTE_PATTERNS = [
  ...Object.values(APP_ROUTE_PATHS),
  ...Object.values(MECHANIC_ROUTE_PATHS),
] as const

const COVERED_ROUTE_PATHS = [
  ...A11Y_SMOKE_ROUTE_PATHS,
  ...A11Y_FULLSTACK_ROUTE_PATHS,
] as const

const EXCEPTIONS_PATH = resolve(import.meta.dirname, '../../e2e/a11y-route-exceptions.json')

function loadExceptions(): Record<string, string> {
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8')) as Record<string, string>
}

function validateA11yRouteCoverage({
  patterns,
  coveredPaths,
  exceptions,
}: {
  patterns: readonly string[]
  coveredPaths: readonly string[]
  exceptions: Record<string, string>
}): { ok: boolean; errors: string[]; message: string } {
  const errors: string[] = []
  const patternSet = new Set(patterns)

  for (const [pattern, reason] of Object.entries(exceptions)) {
    if (pattern.includes('*') || pattern.includes('?')) {
      errors.push(`Wildcard or prefix exception is not allowed: "${pattern}"`)
    } else if (!patternSet.has(pattern)) {
      errors.push(`Unknown route pattern in exceptions: "${pattern}"`)
    }

    if (typeof reason !== 'string' || reason.trim().length === 0) {
      errors.push(`Exception for "${pattern}" has an empty reason`)
    }
  }

  for (const pattern of patterns) {
    const isCovered = coveredPaths.some(
      (coveredPath) => matchRoutes([{ path: pattern }], coveredPath) !== null,
    )
    const isExcepted = Object.prototype.hasOwnProperty.call(exceptions, pattern)

    if (isCovered && isExcepted) {
      errors.push(`Route "${pattern}" is already covered — remove from exceptions`)
    } else if (!isCovered && !isExcepted) {
      errors.push(`Route "${pattern}" has no a11y coverage and no exception`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    message: errors.join('\n'),
  }
}

describe('isKnownAppPath', () => {
  it('recognizes registered application routes', () => {
    expect(isKnownAppPath(APP_ROUTE_PATHS.dashboard)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.inventory)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.hrEmployees)).toBe(true)
    expect(isKnownAppPath(MECHANIC_ROUTE_PATHS.queue)).toBe(true)
    expect(isKnownAppPath('/workshop/orders/abc-123')).toBe(true)
    expect(isKnownAppPath('/workshop/orders/abc-123/garantie-kulanz')).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.workshopPick)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.workshopPickList)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.vehicleStockAlias)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.salesInvoices)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.financeInvoices)).toBe(true)
    expect(isKnownAppPath(APP_ROUTE_PATHS.invoicesLegacy)).toBe(true)
  })

  it('rejects unknown routes', () => {
    expect(isKnownAppPath('/this-route-does-not-exist-qa')).toBe(false)
    expect(isKnownAppPath('/login')).toBe(false)
  })
})

describe('a11y route coverage guard (AUT-1016)', () => {
  it('Scenario 1: passes when every pattern is covered or excepted', () => {
    const result = validateA11yRouteCoverage({
      patterns: KNOWN_ROUTE_PATTERNS,
      coveredPaths: COVERED_ROUTE_PATHS,
      exceptions: loadExceptions(),
    })

    expect(result.ok, result.message).toBe(true)
  })

  it('Scenario 2: fails naming the pattern when a new pattern is added without scan or exception', () => {
    const result = validateA11yRouteCoverage({
      patterns: [...KNOWN_ROUTE_PATTERNS, '/workshop/unscanned-new-route'],
      coveredPaths: COVERED_ROUTE_PATHS,
      exceptions: loadExceptions(),
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('/workshop/unscanned-new-route')
  })

  it('Scenario 3: fails when an exception has an empty reason', () => {
    const result = validateA11yRouteCoverage({
      patterns: KNOWN_ROUTE_PATTERNS,
      coveredPaths: COVERED_ROUTE_PATHS,
      exceptions: {
        ...loadExceptions(),
        [APP_ROUTE_PATHS.hr]: '   ',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain(APP_ROUTE_PATHS.hr)
  })

  it('Scenario 4: fails with "remove from exceptions" when an excepted pattern becomes covered', () => {
    const result = validateA11yRouteCoverage({
      patterns: KNOWN_ROUTE_PATTERNS,
      coveredPaths: COVERED_ROUTE_PATHS,
      exceptions: {
        ...loadExceptions(),
        [APP_ROUTE_PATHS.customers]: 'stale exception',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('remove from exceptions')
    expect(result.message).toContain(APP_ROUTE_PATHS.customers)
  })

  it('Anti-criterion: fails when a wildcard or prefix exception is listed', () => {
    const result = validateA11yRouteCoverage({
      patterns: KNOWN_ROUTE_PATTERNS,
      coveredPaths: COVERED_ROUTE_PATHS,
      exceptions: {
        ...loadExceptions(),
        '/workshop/*': 'prefix exception',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('/workshop/*')
  })
})
