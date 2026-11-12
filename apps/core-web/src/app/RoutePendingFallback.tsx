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

/**
 * Immediate route-pending skeleton for main-list routes while a lazy chunk or locale bundle
 * is still loading, reusing the existing AUT-879 R2 skeleton primitives.
 */
export function RoutePendingFallback({ pathname }: { pathname: string }) {
  if (!isMainListRoutePath(pathname)) {
    return <PageLoader />
  }
  if (pathname === APP_ROUTE_PATHS.workshopPlanner) {
    return <PlannerRouteSkeleton />
  }
  return <ListRouteSkeleton />
}
