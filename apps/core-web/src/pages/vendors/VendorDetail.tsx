import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileUp, Mail, Package, ReceiptText, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { useVendor, useUpdateVendor, useVendorArticles } from '@/api/vendors'
import { BrandMultiSelect } from '@/components/BrandMultiSelect'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { parseLocalDate } from '@/lib/date-utils'
import { formatDate } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type {
  PurchaseInvoiceStatus,
  PurchaseOrderStatus,
  Vendor,
} from '@/api/types'

type VendorPurchaseOrderItemSummary = {
  quantity: string | number
  unit_cost: string | number
}

type VendorPurchaseOrderSummary = {
  id: string
  order_number: string
  status: PurchaseOrderStatus
  createdAt: string
  items?: VendorPurchaseOrderItemSummary[]
}

type VendorPurchaseInvoiceSummary = {
  id: string
  invoice_number?: string | null
  vendor_invoice_number: string
  status: PurchaseInvoiceStatus
  invoice_date: string
  total_amount: string | number
}

type VendorDetailResponse = Vendor & {
  purchase_orders?: VendorPurchaseOrderSummary[]
  purchase_invoices?: VendorPurchaseInvoiceSummary[]
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getPurchaseOrderTotal(order: VendorPurchaseOrderSummary) {
  return (order.items ?? []).reduce(
    (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_cost),
    0,
  )
}

export default function VendorDetail() {
  const { t } = useTranslation(['finance', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: vendor, isLoading, error } = useVendor<VendorDetailResponse>(id ?? '')
  const { data: articles = [], isLoading: isLoadingArticles } = useVendorArticles(vendor?.id)
  const updateVendor = useUpdateVendor()
  const [draftBrands, setDraftBrands] = useState<{ vendorId: string | null; ids: number[] | null }>({
    vendorId: null,
    ids: null,
  })
  const lastRequestId = useRef(0)

  // Derived value for UI: use user edits if they match the current vendor, otherwise fall back to vendor data
  const isCorrectVendor = draftBrands.vendorId === vendor?.id
  const brandIdsForUi = (isCorrectVendor && draftBrands.ids !== null)
    ? draftBrands.ids 
    : vendor?.supportedBrands?.map((b) => b.id) ?? []

  if (isLoading) {
    return <div className='p-8 text-center'>{t('vendors.detail.loading', { ns: 'finance' })}</div>
  }

  if (error) {
    return (
      <div className='p-8 text-center'>
        {t('vendors.detail.loadFailed', {
          ns: 'finance',
          message: (error as Error).message,
        })}
      </div>
    )
  }

  if (!vendor) {
    return <div className='p-8 text-center'>{t('vendors.detail.notFound', { ns: 'finance' })}</div>
  }

  const activeOrders = (vendor.purchase_orders ?? [])
    .filter((order) => order.status !== 'COMPLETED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  type EditableVendorField = 'name' | 'email' | 'account_number'

  const handleSaveVendorField = async (
    field: EditableVendorField,
    nextValue: string,
  ) => {
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        data: {
          [field]: nextValue,
        },
      })
      toast.success(t('vendors.detail.toast.updated', { ns: 'finance' }))
    } catch (updateError: unknown) {
      if (updateError instanceof Error) {
        toast.error(updateError.message)
      } else {
        toast.error(t('vendors.detail.toast.updateFailed', { ns: 'finance' }))
      }
      throw updateError
    }
  }

  const handleBrandChange = async (brandIds: number[]) => {
    if (!vendor) return
    const requestId = ++lastRequestId.current
    const previousBrandIds = brandIdsForUi
    
    // Optimistic update with vendorId keying
    setDraftBrands({ vendorId: vendor.id, ids: brandIds })
    
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        data: {
          brandIds: brandIds,
        },
      })
      
      if (requestId === lastRequestId.current) {
        toast.success(t('vendors.detail.toast.brandsUpdated', { ns: 'finance' }))
      }
    } catch (updateError: unknown) {
      // Only rollback if this was the latest request and matches the current vendor
      if (requestId === lastRequestId.current) {
        setDraftBrands({ vendorId: vendor.id, ids: previousBrandIds })
        if (updateError instanceof Error) {
          toast.error(updateError.message)
        } else {
          toast.error(t('vendors.detail.toast.brandsUpdateFailed', { ns: 'finance' }))
        }
      }
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='icon' asChild>
            <Link to='/vendors' aria-label={t('vendors.detail.backAria', { ns: 'finance' })}>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>{vendor.name}</h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              <span>{t('vendors.detail.idLabel', { ns: 'finance', idShort: vendor.id.substring(0, 8) })}</span>
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' asChild>
            <Link to={`/settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=${vendor.id}`}>
              <FileUp className='mr-2 h-4 w-4' /> {t('vendors.detail.importPriceList', { ns: 'finance' })}
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/purchase-orders/new?vendorId=${vendor.id}`}>
              <Package className='mr-2 h-4 w-4' /> {t('vendors.detail.purchaseOrder', { ns: 'finance' })}
            </Link>
          </Button>
          <Button variant='outline' asChild>
            <Link to={`/purchase-bills/new?vendorId=${vendor.id}`}>
              <ReceiptText className='mr-2 h-4 w-4' /> {t('vendors.detail.purchaseBill', { ns: 'finance' })}
            </Link>
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>{t('vendors.detail.contactInformation', { ns: 'finance' })}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <div className='text-xs text-muted-foreground mb-1'>{t('vendors.detail.vendorName', { ns: 'finance' })}</div>
              <InlineEdit
                value={vendor.name}
                onSave={(nextValue) => handleSaveVendorField('name', nextValue)}
                placeholder={t('vendors.detail.vendorNamePlaceholder', { ns: 'finance' })}
                emptyText={t('vendors.detail.addVendorName', { ns: 'finance' })}
                ariaLabel={t('vendors.detail.vendorNameAria', { ns: 'finance' })}
              />
            </div>
            <div className='flex items-center gap-2'>
              <Mail className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={vendor.email}
                onSave={(nextValue) => handleSaveVendorField('email', nextValue)}
                placeholder={t('vendors.detail.emailPlaceholder', { ns: 'finance' })}
                emptyText={t('vendors.detail.addEmail', { ns: 'finance' })}
                ariaLabel={t('vendors.detail.vendorEmailAria', { ns: 'finance' })}
              />
            </div>
            <div className='pt-2 border-t'>
              <span className='text-sm font-medium'>{t('vendors.detail.accountNumberLabel', { ns: 'finance' })}</span>
              <div className='mt-1'>
                <InlineEdit
                  value={vendor.account_number}
                  onSave={(nextValue) => handleSaveVendorField('account_number', nextValue)}
                  placeholder={t('vendors.detail.accountNumberPlaceholder', { ns: 'finance' })}
                  emptyText={t('vendors.detail.addAccountNumber', { ns: 'finance' })}
                  ariaLabel={t('vendors.detail.accountNumberAria', { ns: 'finance' })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>{t('vendors.detail.tabs.activeOrders', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='invoices'>{t('vendors.detail.tabs.invoiceHistory', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='brands'>{t('vendors.detail.tabs.supportedBrands', { ns: 'finance' })}</TabsTrigger>
              <TabsTrigger value='articles'>{t('vendors.detail.tabs.vendorArticles', { ns: 'finance' })}</TabsTrigger>
            </TabsList>

            <TabsContent value='orders' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('columns.orderNumber', { ns: 'finance' })}</TableHead>
                        <TableHead>{t('columns.date', { ns: 'finance' })}</TableHead>
                        <TableHead>{t('columns.status', { ns: 'finance' })}</TableHead>
                        <TableHead className='text-right'>{t('columns.total', { ns: 'finance' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeOrders.map((order) => (
                        <TableRow
                          key={order.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/purchase-orders/${order.id}`)}
                          tabIndex={0}
                          role='button'
                          aria-label={t('vendors.detail.openOrderAria', {
                            ns: 'finance',
                            number: order.order_number,
                          })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/purchase-orders/${order.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{order.order_number}</TableCell>
                          <TableCell>{(() => {
                            const date = parseLocalDate(order.createdAt)
                            return date ? formatDate(date) : t('common:placeholders.missing', { ns: 'common' })
                          })()}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(getPurchaseOrderTotal(order))}</TableCell>
                        </TableRow>
                      ))}
                      {activeOrders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('vendors.detail.noActiveOrders', { ns: 'finance' })}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='invoices' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('columns.invoiceNumber', { ns: 'finance' })}</TableHead>
                        <TableHead>{t('columns.date', { ns: 'finance' })}</TableHead>
                        <TableHead>{t('columns.status', { ns: 'finance' })}</TableHead>
                        <TableHead className='text-right'>{t('columns.total', { ns: 'finance' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(vendor.purchase_invoices ?? []).map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className='font-medium'>
                            {invoice.invoice_number || invoice.vendor_invoice_number || t('vendors.detail.draftShort', { ns: 'finance' })}
                          </TableCell>
                          <TableCell>{(() => {
                            const date = parseLocalDate(invoice.invoice_date)
                            return date ? formatDate(date) : t('common:placeholders.missing', { ns: 'common' })
                          })()}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_amount))}</TableCell>
                        </TableRow>
                      ))}
                      {(vendor.purchase_invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('vendors.detail.noPurchaseInvoices', { ns: 'finance' })}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='brands' className='mt-4'>
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-base font-semibold flex items-center gap-2'>
                    <Tags className='h-4 w-4' />
                    {t('vendors.detail.tabs.supportedBrands', { ns: 'finance' })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BrandMultiSelect 
                    value={brandIdsForUi} 
                    onChange={handleBrandChange} 
                    isUpdating={updateVendor.isPending}
                    ariaLabel={t('vendors.detail.brandsAria', { ns: 'finance', name: vendor.name })}
                  />
                  <p className='text-xs text-slate-500 mt-3'>
                    {t('vendors.detail.brandsHint', { ns: 'finance' })}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='articles' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('columns.vendorArticleNo', { ns: 'finance' })}</TableHead>
                        <TableHead>{t('columns.catalogItem', { ns: 'finance' })}</TableHead>
                        <TableHead className='text-right'>{t('columns.lastCost', { ns: 'finance' })}</TableHead>
                        <TableHead className='text-right'>{t('columns.lastRrp', { ns: 'finance' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoadingArticles ? (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>
                            {t('vendors.detail.loadingArticles', { ns: 'finance' })}
                          </TableCell>
                        </TableRow>
                      ) : articles.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>
                            {t('vendors.detail.noVendorArticles', { ns: 'finance' })}
                          </TableCell>
                        </TableRow>
                      ) : (
                        articles.map((art) => (
                          <TableRow key={art.id}>
                            <TableCell className='font-mono font-medium text-xs'>
                              {art.vendor_article_no}
                            </TableCell>
                            <TableCell>
                              {art.catalog_item ? (
                                <div className='flex items-center gap-2'>
                                  <span className='font-medium'>{art.catalog_item.name}</span>
                                  <span className='text-xs text-muted-foreground font-mono'>
                                    ({art.catalog_item.sku})
                                  </span>
                                </div>
                              ) : (
                                t('common:placeholders.missing', { ns: 'common' })
                              )}
                            </TableCell>
                            <TableCell className='text-right'>
                              {art.last_cost != null ? formatCurrency(toNumber(art.last_cost)) : t('common:placeholders.missing', { ns: 'common' })}
                            </TableCell>
                            <TableCell className='text-right'>
                              {art.last_rrp != null ? formatCurrency(toNumber(art.last_rrp)) : t('common:placeholders.missing', { ns: 'common' })}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
