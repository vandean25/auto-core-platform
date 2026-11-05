import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileUp, Package, ReceiptText } from 'lucide-react'
import { useVendor, useVendorArticles } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PageHeader } from '@/components/layout/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import {
  VendorArticlesTab,
  VendorBrandsTab,
  VendorContactCard,
  VendorInvoicesTab,
  VendorOrdersTab,
  type VendorDetailResponse,
} from './vendor-detail-tabs'
import { useVendorDetailActions } from './useVendorDetailActions'

function VendorMessage({ children }: { children: string }) {
  return (
    <Empty>
      <EmptyDescription>{children}</EmptyDescription>
    </Empty>
  )
}

export default function VendorDetail() {
  const { t } = useTranslation(['finance', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const { id } = useParams<{ id: string }>()
  const { data: vendor, isLoading, error } = useVendor<VendorDetailResponse>(id ?? '')
  const { data: articles = [], isLoading: isLoadingArticles } = useVendorArticles(vendor?.id)
  const { brandIds, saveField, changeBrands, isUpdating } = useVendorDetailActions(vendor)

  if (isLoading) {
    return <DetailSkeleton label={t('vendors.detail.loading', { ns: 'finance' })} />
  }
  if (error) {
    return <VendorMessage>{t('vendors.detail.loadFailed', { ns: 'finance', message: (error as Error).message })}</VendorMessage>
  }
  if (!vendor) {
    return <VendorMessage>{t('vendors.detail.notFound', { ns: 'finance' })}</VendorMessage>
  }

  const activeOrders = (vendor.purchase_orders ?? [])
    .filter((order) => order.status !== 'COMPLETED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className='space-y-6'>
      <PageHeader
        leading={
          <Button variant='ghost' size='icon' className='max-sm:min-h-11 max-sm:min-w-11' asChild>
            <Link to='/vendors' aria-label={t('vendors.detail.backAria', { ns: 'finance' })}>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
        }
        title={vendor.name}
        description={t('vendors.detail.idLabel', { ns: 'finance', idShort: vendor.id.substring(0, 8) })}
        actions={
          <>
          <Button variant='outline' className='max-sm:min-h-11' asChild>
            <Link to={`/settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=${vendor.id}`}>
              <FileUp className='mr-2 h-4 w-4' /> {t('vendors.detail.importPriceList', { ns: 'finance' })}
            </Link>
          </Button>
          <Button className='max-sm:min-h-11' asChild>
            <Link to={`/purchase-orders/new?vendorId=${vendor.id}`}>
              <Package className='mr-2 h-4 w-4' /> {t('vendors.detail.purchaseOrder', { ns: 'finance' })}
            </Link>
          </Button>
          <Button variant='outline' className='max-sm:min-h-11' asChild>
            <Link to={`/purchase-bills/new?vendorId=${vendor.id}`}>
              <ReceiptText className='mr-2 h-4 w-4' /> {t('vendors.detail.purchaseBill', { ns: 'finance' })}
            </Link>
          </Button>
          </>
        }
      />

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <VendorContactCard vendor={vendor} onSaveField={saveField} />

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>{t('vendors.detail.tabs.activeOrders', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='invoices'>{t('vendors.detail.tabs.invoiceHistory', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='brands'>{t('vendors.detail.tabs.supportedBrands', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='articles'>{t('vendors.detail.tabs.vendorArticles', { ns: 'finance' })}</TabsTrigger>
            </TabsList>

            <TabsContent value='orders' className='mt-4'>
              <VendorOrdersTab orders={activeOrders} />
            </TabsContent>
            <TabsContent value='invoices' className='mt-4'>
              <VendorInvoicesTab invoices={vendor.purchase_invoices ?? []} />
            </TabsContent>
            <TabsContent value='brands' className='mt-4'>
              <VendorBrandsTab vendor={vendor} brandIds={brandIds} isUpdating={isUpdating} onChange={changeBrands} />
            </TabsContent>
            <TabsContent value='articles' className='mt-4'>
              <VendorArticlesTab articles={articles} isLoading={isLoadingArticles} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
