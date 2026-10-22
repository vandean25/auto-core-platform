import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCustomer } from '@/api/customers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/layout/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ArrowLeft, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { CustomerContactCard } from './CustomerContactCard'
import { CustomerDetailTabs } from './CustomerDetailTabs'
import { CustomerStartService } from './CustomerStartService'
import { getCustomerDisplayName, type CustomerDetailResponse } from './customer-detail-model'

export default function CustomerDetail() {
  const { t } = useTranslation('customers')
  useEffect(() => {
    void ensureNamespaceLoaded('customers')
  }, [])
  const { id } = useParams<{ id: string }>()
  const { data: customer, isLoading, error } = useCustomer<CustomerDetailResponse>(id ?? '')
  const customerName = customer ? getCustomerDisplayName(customer) : undefined
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.customers,
    currentLabel: customerName || t('detail.breadcrumbFallback'),
  })

  if (isLoading) {
    return <DetailSkeleton label={t('detail.loading')} />
  }

  if (error) {
    return (
      <div className='p-8 text-center'>
        {t('detail.loadFailed', { message: (error as Error).message })}
      </div>
    )
  }

  if (!customer) {
    return <div className='p-8 text-center'>{t('detail.notFound')}</div>
  }

  return (
    <div className='space-y-6'>
      <PageHeader
        title={getCustomerDisplayName(customer)}
        leading={
          <Button variant='ghost' size='icon' asChild>
            <Link to='/customers' aria-label={t('detail.backAria')}>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
        }
        description={
          <div className='flex items-center gap-2'>
            {customer.type === 'COMPANY' && <Badge variant='outline'>{t('detail.companyBadge')}</Badge>}
            <span>{t('detail.idLabel', { id: customer.id.substring(0, 8) })}</span>
          </div>
        }
        actions={
          <div className='flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end'>
            <div className='flex flex-wrap justify-start gap-2 sm:justify-end'>
              <Button asChild>
                <Link to={`/sales-orders/new?customerId=${customer.id}`}>
                  <Package className='mr-2 h-4 w-4' /> {t('detail.newSalesOrder')}
                </Link>
              </Button>
              <CustomerStartService customerId={customer.id} vehicles={customer.vehicles ?? []} />
            </div>
            <p className='text-xs text-muted-foreground'>{t('detail.invoiceHint')}</p>
          </div>
        }
      />

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <CustomerContactCard customer={customer} />
        <div className='lg:col-span-2'>
          <CustomerDetailTabs customer={customer} />
        </div>
      </div>
    </div>
  )
}
