import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const routeTreeSource = readFileSync(resolve(repoRoot, 'src/app/AppRouteTree.tsx'), 'utf8')

/** Paths that must sit under a lazy-namespace layout so first paint never shows raw keys. */
const GATED_ROUTE_MARKERS: Array<{ marker: string; layoutNamespace: string }> = [
  { marker: `path={APP_ROUTE_PATHS.tyreStorage}`, layoutNamespace: 'inventory' },
  { marker: `path={APP_ROUTE_PATHS.workshopKpiReports}`, layoutNamespace: 'reports' },
  { marker: `path={APP_ROUTE_PATHS.settings}`, layoutNamespace: 'settings' },
  { marker: `path={APP_ROUTE_PATHS.vehicleStock}`, layoutNamespace: 'vehicleStock' },
  { marker: `path={APP_ROUTE_PATHS.purchaseBills}`, layoutNamespace: 'finance' },
  { marker: `path={APP_ROUTE_PATHS.salesInvoiceDetail}`, layoutNamespace: 'sales' },
]

function layoutSectionBefore(marker: string, namespace: string): boolean {
  const markerIndex = routeTreeSource.indexOf(marker)
  expect(markerIndex, `route marker not found: ${marker}`).toBeGreaterThanOrEqual(0)
  const prefix = routeTreeSource.slice(0, markerIndex)
  const layoutNeedle = `<LazyNamespaceLayout namespaces={[${JSON.stringify(namespace)}`
  const altLayoutNeedle = `<LazyNamespaceLayout namespaces={['${namespace}']}`
  const workshopLayout = namespace === 'workshop' ? '<WorkshopNamespaceLayout' : ''
  return (
    prefix.includes(layoutNeedle)
    || prefix.includes(altLayoutNeedle)
    || (workshopLayout !== '' && prefix.includes(workshopLayout))
    || prefix.includes(`<LazyNamespaceLayout namespaces={['${namespace}',`)
    || prefix.includes(`<LazyNamespaceLayout namespaces={["${namespace}",`)
  )
}

describe('lazy namespace route guard (AUT-945)', () => {
  it('documents gated first-visit routes in app route paths', () => {
    expect(APP_ROUTE_PATHS.tyreStorage).toBeTruthy()
    expect(APP_ROUTE_PATHS.workshopKpiReports).toBeTruthy()
  })

  it.each(GATED_ROUTE_MARKERS)(
    'wraps $marker behind a $layoutNamespace lazy namespace layout',
    ({ marker, layoutNamespace }) => {
      expect(layoutSectionBefore(marker, layoutNamespace)).toBe(true)
    },
  )
})
