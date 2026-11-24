import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Car,
  FileText,
  History,
  Mail,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Wrench,
} from 'lucide-react'
import {
  customerKeys,
  useCustomerActivity,
  type CustomerActivityItem,
  type CustomerActivityType,
} from '@/api/customers'
import { InfiniteListRefreshNotice } from '@/components/list/InfiniteListRefreshNotice'
import { StatusBadge } from '@/components/status/StatusBadge'
import { statusClassMap } from '@/components/status/status-class-map'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  ACTIVITY_FILTER_CHIPS,
  buildActivitySummaryParts,
  isChipSelected,
  parseActivityTypesParam,
  toggleActivityChip,
} from './customer-activity-model'

const ACTIVITY_TYPE_KEYS = {
  workshop_order: 'activity.types.workshop_order',
  sales_order: 'activity.types.sales_order',
  invoice: 'activity.types.invoice',
  credit_note: 'activity.types.credit_note',
  email: 'activity.types.email',
  consent: 'activity.types.consent',
  vehicle_notice: 'activity.types.vehicle_notice',
  loaner_booking: 'activity.types.loaner_booking',
  audit: 'activity.types.audit',
} as const satisfies Record<CustomerActivityType, string>

const ACTIVITY_FILTER_KEYS = {
  orders: 'activity.filters.orders',
  invoices: 'activity.filters.invoices',
  emails: 'activity.filters.emails',
  consents: 'activity.filters.consents',
  vehicleNotices: 'activity.filters.vehicleNotices',
  loanerBookings: 'activity.filters.loanerBookings',
  audit: 'activity.filters.audit',
} as const

const TYPE_ICONS: Record<CustomerActivityType, typeof Wrench> = {
  workshop_order: Wrench,
  sales_order: ShoppingBag,
  invoice: Receipt,
  credit_note: FileText,
  email: Mail,
  consent: ShieldCheck,
  vehicle_notice: AlertTriangle,
  loaner_booking: Car,
  audit: History,
}

function ActivityStatusBadge({ status }: { status: unknown }) {
  if (typeof status !== 'string' || status.length === 0) {
    return null
  }
  if (Object.hasOwn(statusClassMap, status)) {
    return <StatusBadge status={status} />
  }
  return <Badge variant='outline'>{status}</Badge>
}

function ActivitySummaryText({ item }: { item: CustomerActivityItem }) {
  const parts = buildActivitySummaryParts(item.summary, formatCurrency)
  if (parts.length === 0) {
    return null
  }
  return <p className='text-xs text-muted-foreground'>{parts.join(' · ')}</p>
}

function ActivityTimelineRow({ item }: { item: CustomerActivityItem }) {
  const { t } = useTranslation('customers')
  const Icon = TYPE_ICONS[item.type]

  return (
    <li className='flex flex-col gap-2 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex min-w-0 items-start gap-3'>
        <div className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
          <Icon className='h-4 w-4' aria-hidden='true' />
        </div>
        <div className='min-w-0 space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-xs font-medium text-muted-foreground'>
              {t(ACTIVITY_TYPE_KEYS[item.type])}
            </span>
            <span className='text-xs text-muted-foreground'>·</span>
            <time dateTime={item.occurred_at} className='text-xs text-muted-foreground tabular-nums'>
              {formatDateTime(item.occurred_at)}
            </time>
            <ActivityStatusBadge status={item.summary.status} />
          </div>
          <p className='truncate text-sm font-medium text-foreground'>{item.title}</p>
          <ActivitySummaryText item={item} />
        </div>
      </div>

      {item.ref_link && (
        <Link
          to={item.ref_link}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-h-11 shrink-0 self-start sm:self-center',
          )}
        >
          {t('activity.openRecord')}
        </Link>
      )}
    </li>
  )
}

function ActivityTimelineBody({
  items,
  isLoading,
  isError,
  hasActiveFilter,
  hasNextPage,
  isFetchingNextPage,
  onRetry,
  onResetFilters,
  onFetchNextPage,
  sentinelRef,
}: {
  items: CustomerActivityItem[]
  isLoading: boolean
  isError: boolean
  hasActiveFilter: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onRetry: () => void
  onResetFilters: () => void
  onFetchNextPage: () => void
  sentinelRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('customers')

  if (isLoading) {
    return (
      <div role='status' className='space-y-3' aria-label={t('activity.loading')}>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center gap-3 py-8 text-center'>
          <p className='text-sm text-muted-foreground'>{t('activity.loadFailed')}</p>
          <button
            type='button'
            onClick={onRetry}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}
          >
            {t('activity.retry')}
          </button>
        </CardContent>
      </Card>
    )
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center gap-3 py-8 text-center'>
          <p className='text-sm text-muted-foreground'>
            {hasActiveFilter ? t('activity.emptyFiltered') : t('activity.empty')}
          </p>
          {hasActiveFilter && (
            <button
              type='button'
              onClick={onResetFilters}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}
            >
              {t('activity.resetFilters')}
            </button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-3'>
      <ul className='space-y-2'>
        {items.map((item) => (
          <ActivityTimelineRow key={`${item.type}-${item.id}`} item={item} />
        ))}
      </ul>
      <div ref={sentinelRef} className='h-1' aria-hidden='true' />
      {hasNextPage && (
        <div className='flex justify-center pt-2'>
          <button
            type='button'
            disabled={isFetchingNextPage}
            onClick={onFetchNextPage}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}
          >
            {isFetchingNextPage ? t('activity.loadingMore') : t('activity.loadMore')}
          </button>
        </div>
      )}
    </div>
  )
}

export function CustomerActivityTimeline({ customerId }: { customerId: string }) {
  const { t } = useTranslation('customers')
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTypes = parseActivityTypesParam(searchParams.get('types'))
  const queryKey = customerKeys.activity(customerId, selectedTypes)
  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCustomerActivity(customerId, selectedTypes)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void fetchNextPage()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const updateTypes = (nextTypes: CustomerActivityType[]) => {
    const next = new URLSearchParams(searchParams)
    if (nextTypes.length > 0) {
      next.set('types', nextTypes.join(','))
    } else {
      next.delete('types')
    }
    setSearchParams(next, { replace: true })
  }

  const items = data?.pages.flatMap((page) => (Array.isArray(page?.data) ? page.data : [])) ?? []

  return (
    <div className='space-y-4'>
      <div
        role='group'
        aria-label={t('activity.filterLabel')}
        className='flex flex-wrap gap-2'
      >
        {ACTIVITY_FILTER_CHIPS.map((chip) => {
          const active = isChipSelected(chip, selectedTypes)
          return (
            <button
              key={chip.key}
              type='button'
              aria-pressed={active}
              onClick={() => updateTypes(toggleActivityChip(chip, selectedTypes))}
              className={cn(
                buttonVariants({ variant: active ? 'default' : 'outline', size: 'sm' }),
                'min-h-11 px-3',
              )}
            >
              {t(ACTIVITY_FILTER_KEYS[chip.key])}
            </button>
          )
        })}
      </div>

      <InfiniteListRefreshNotice queryKey={queryKey} />

      <ActivityTimelineBody
        items={items}
        isLoading={isLoading}
        isError={isError}
        hasActiveFilter={selectedTypes.length > 0}
        hasNextPage={Boolean(hasNextPage)}
        isFetchingNextPage={isFetchingNextPage}
        onRetry={() => void refetch()}
        onResetFilters={() => updateTypes([])}
        onFetchNextPage={() => void fetchNextPage()}
        sentinelRef={sentinelRef}
      />
    </div>
  )
}
