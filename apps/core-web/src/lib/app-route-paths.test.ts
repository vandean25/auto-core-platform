// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  A11Y_FULLSTACK_CHECKPOINT_PATHS,
  A11Y_FULLSTACK_ROUTE_PATHS,
} from '../../e2e-fullstack/a11y-checkpoint-paths'
import {
  A11Y_SMOKE_PATHS_BY_NAME,
  A11Y_SMOKE_ROUTE_PATHS,
} from '../../e2e/utils/a11y-smoke-route-paths'
import {
  APP_ROUTE_PATHS,
  MECHANIC_ROUTE_PATHS,
  isKnownAppPath,
  matchKnownAppRoutePattern,
} from './app-route-paths'

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

  const routeObjects = patterns.map((path) => ({ path }))
  const coveredPatterns = new Set<string>()

  for (const coveredPath of coveredPaths) {
    const matches = matchRoutes(routeObjects, coveredPath)
    const winningPattern = matches?.[0]?.route.path
    if (winningPattern) {
      coveredPatterns.add(winningPattern)
    }
  }

  for (const pattern of patterns) {
    const isCovered = coveredPatterns.has(pattern)
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

  it('ranks route matching so static /vehicle-stock/purchases/new leaves /vehicle-stock/purchases/:id uncovered', () => {
    const result = validateA11yRouteCoverage({
      patterns: [
        APP_ROUTE_PATHS.vehicleStockPurchaseNew,
        APP_ROUTE_PATHS.vehicleStockPurchaseDetail,
      ],
      coveredPaths: ['/vehicle-stock/purchases/new'],
      exceptions: {},
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain(APP_ROUTE_PATHS.vehicleStockPurchaseDetail)
  })

  it('resolves known route patterns via matchKnownAppRoutePattern', () => {
    expect(matchKnownAppRoutePattern('/sales-orders/so-1')).toBe(APP_ROUTE_PATHS.salesOrderDetail)
    expect(matchKnownAppRoutePattern('/vehicle-stock/purchases/new')).toBe(
      APP_ROUTE_PATHS.vehicleStockPurchaseNew,
    )
    expect(matchKnownAppRoutePattern('/mechanic/tasks/task-1')).toBe(
      MECHANIC_ROUTE_PATHS.taskDetail,
    )
    expect(matchKnownAppRoutePattern('/login')).toBeNull()
  })

  it('passes every A11Y_FULLSTACK_CHECKPOINT_PATHS key to scanA11y under e2e-fullstack', () => {
    const fullstackDir = resolve(import.meta.dirname, '../../e2e-fullstack')
    const fullstackSource = readdirSync(fullstackDir)
      .filter(
        (name) =>
          name.endsWith('.ts') &&
          name !== 'a11y-checkpoint.ts' &&
          name !== 'a11y-checkpoint-paths.ts',
      )
      .map((name) => readFileSync(resolve(fullstackDir, name), 'utf8'))
      .join('\n')

    for (const checkpointId of Object.keys(A11Y_FULLSTACK_CHECKPOINT_PATHS)) {
      const escaped = checkpointId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(
        fullstackSource,
        `checkpoint "${checkpointId}" must be passed to scanA11y under e2e-fullstack`,
      ).toMatch(new RegExp(`\\bscanA11y\\s*\\([^)]*,\\s*['"]${escaped}['"]\\s*\\)`))
    }
  })

  it('derives every A11Y_SMOKE_ROUTES path from A11Y_SMOKE_PATHS_BY_NAME', () => {
    const smokeRoutesPath = resolve(import.meta.dirname, '../../e2e/utils/a11y-smoke-routes.ts')
    const source = readFileSync(smokeRoutesPath, 'utf8')
    const arrayStart = source.indexOf('export const A11Y_SMOKE_ROUTES')
    expect(arrayStart).toBeGreaterThan(-1)
    const routesSection = source.slice(arrayStart)

    const pathLines = [...routesSection.matchAll(/^\s*path:\s*(.+?),?\s*$/gm)].map((m) =>
      m[1].trim(),
    )
    const referencedKeys = pathLines.map((expr) => {
      const match = expr.match(/^A11Y_SMOKE_PATHS_BY_NAME\[['"]([^'"]+)['"]\]$/)
      expect(match, `expected A11Y_SMOKE_PATHS_BY_NAME lookup, got: ${expr}`).not.toBeNull()
      return match![1]
    })

    expect(new Set(referencedKeys)).toEqual(new Set(Object.keys(A11Y_SMOKE_PATHS_BY_NAME)))
  })
})
