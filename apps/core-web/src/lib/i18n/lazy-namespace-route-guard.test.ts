import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const routeTreeSource = readFileSync(resolve(repoRoot, 'src/app/AppRouteTree.tsx'), 'utf8')

/** Routes that must be direct children of a lazy-namespace layout (exact namespace set). */
const GATED_ROUTE_MARKERS: Array<{ marker: string; layoutNamespaces: string[] }> = [
  { marker: `path={APP_ROUTE_PATHS.tyreStorage}`, layoutNamespaces: ['inventory'] },
  { marker: `path={APP_ROUTE_PATHS.workshopKpiReports}`, layoutNamespaces: ['reports'] },
  { marker: `path={APP_ROUTE_PATHS.settings}`, layoutNamespaces: ['settings'] },
  { marker: `path={APP_ROUTE_PATHS.vehicleStock}`, layoutNamespaces: ['vehicleStock'] },
  { marker: `path={APP_ROUTE_PATHS.purchaseBills}`, layoutNamespaces: ['finance'] },
  { marker: `path={APP_ROUTE_PATHS.salesInvoiceDetail}`, layoutNamespaces: ['sales', 'finance'] },
]

function parseLayoutNamespaces(layoutLiteral: string): string[] {
  return [...layoutLiteral.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** Namespace list on the innermost LazyNamespaceLayout that encloses this route marker. */
function layoutNamespacesForRoute(marker: string): string[] | null {
  const markerIndex = routeTreeSource.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  const prefix = routeTreeSource.slice(0, markerIndex)
  const layoutPattern =
    /<Route element=\{<LazyNamespaceLayout namespaces=\{(\[[^\]]+\])\} \/>}>/g
  let lastNamespaces: string[] | null = null
  for (const match of prefix.matchAll(layoutPattern)) {
    lastNamespaces = parseLayoutNamespaces(match[1])
  }
  return lastNamespaces
}

describe('lazy namespace route guard (AUT-945)', () => {
  it.each(GATED_ROUTE_MARKERS)(
    'places $marker under LazyNamespaceLayout $layoutNamespaces',
    ({ marker, layoutNamespaces }) => {
      expect(layoutNamespacesForRoute(marker)).toEqual(layoutNamespaces)
    },
  )
})
