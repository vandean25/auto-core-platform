import { useTranslation } from 'react-i18next'
import { PageLoader } from '@/components/ui/PageLoader'
import { Skeleton } from '@/components/ui/skeleton'
import { CardSkeleton, TableSkeleton } from '@/components/ui/skeleton-presets'
import { Table, TableBody } from '@/components/ui/table'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { isMainListRoutePath } from './route-chunk-prefetch'

function PageHeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-32" />
    </div>
  )
}

function ListRouteSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <div className="rounded-md border border-border">
          <Table aria-busy="true">
            <TableBody>
              <TableSkeleton rows={5} cols={4} delayMs={0} />
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function PlannerRouteSkeleton() {
  const { t } = useTranslation('common')
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">{t('shell.loading')}</span>
      <PageHeaderSkeleton />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <CardSkeleton lines={4} />
      </div>
    </div>
  )
}

const LIST_SKELETON_ROUTE_PATHS = new Set<string>([
  APP_ROUTE_PATHS.workshopOrders,
  APP_ROUTE_PATHS.vehicles,
  APP_ROUTE_PATHS.workshopEstimates,
  APP_ROUTE_PATHS.tyreStorage,
  APP_ROUTE_PATHS.purchaseOrders,
  APP_ROUTE_PATHS.salesInvoices,
  APP_ROUTE_PATHS.customers,
  APP_ROUTE_PATHS.inventory,
  APP_ROUTE_PATHS.salesOrders,
  APP_ROUTE_PATHS.purchaseBills,
  APP_ROUTE_PATHS.vendors,
  APP_ROUTE_PATHS.stockTransfers,
  APP_ROUTE_PATHS.vehicleStock,
])

function normalizePathname(pathname: string): string {
  const withoutHash = pathname.split('#', 1)[0] ?? ''
  return withoutHash.split('?', 1)[0] ?? ''
}

/**
 * Immediate route-pending skeleton for list routes while a lazy chunk or locale bundle
 * is still loading, reusing the existing AUT-879 R2 skeleton primitives.
 */
export function RoutePendingFallback({ pathname }: { pathname: string }) {
  const normalized = normalizePathname(pathname)
  if (normalized === APP_ROUTE_PATHS.workshopPlanner) {
    return <PlannerRouteSkeleton />
  }
  if (isMainListRoutePath(normalized) || LIST_SKELETON_ROUTE_PATHS.has(normalized)) {
    return <ListRouteSkeleton />
  }
  return <PageLoader />
}
