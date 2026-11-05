import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Tags } from 'lucide-react'
import { BrandMultiSelect } from '@/components/BrandMultiSelect'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { parseLocalDate } from '@/lib/date-utils'
import { formatDate } from '@/lib/format'
import type { PurchaseInvoiceStatus, PurchaseOrderStatus, Vendor } from '@/api/types'
import type { useVendorArticles } from '@/api/vendors'

export type VendorPurchaseOrderSummary = {
  id: string
  order_number: string
  status: PurchaseOrderStatus
  createdAt: string
  items?: Array<{ quantity: string | number; unit_cost: string | number }>
}

export type VendorPurchaseInvoiceSummary = {
  id: string
  invoice_number?: string | null
  vendor_invoice_number: string
  status: PurchaseInvoiceStatus
  invoice_date: string
  total_amount: string | number
}

export type VendorDetailResponse = Vendor & {
  purchase_orders?: VendorPurchaseOrderSummary[]
  purchase_invoices?: VendorPurchaseInvoiceSummary[]
}

type VendorArticle = NonNullable<ReturnType<typeof useVendorArticles>['data']>[number]

export function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getPurchaseOrderTotal(order: VendorPurchaseOrderSummary) {
  return (order.items ?? []).reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_cost), 0)
}

function useDateLabel() {
  const { t } = useTranslation(['finance', 'common'])
  return (value: string) => {
    const date = parseLocalDate(value)
    return date ? formatDate(date) : t('placeholders.missing', { ns: 'common' })
  }
}

function MissingValue() {
  const { t } = useTranslation(['finance', 'common'])
  return <>{t('placeholders.missing', { ns: 'common' })}</>
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className='text-center py-4 text-muted-foreground'>
        {children}
      </TableCell>
    </TableRow>
  )
}

export function VendorContactCard({
  vendor,
  onSaveField,
}: {
  vendor: Vendor
  onSaveField: (field: 'name' | 'email' | 'account_number', value: string) => Promise<void>
}) {
  const { t } = useTranslation(['finance', 'common'])

  return (
    <Card className='lg:col-span-1'>
      <CardHeader>
        <CardTitle className='text-base font-semibold'>{t('vendors.detail.contactInformation', { ns: 'finance' })}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div>
          <div className='text-xs text-muted-foreground mb-1'>{t('vendors.detail.vendorName', { ns: 'finance' })}</div>
          <InlineEdit
            value={vendor.name}
            onSave={(nextValue) => onSaveField('name', nextValue)}
            placeholder={t('vendors.detail.vendorNamePlaceholder', { ns: 'finance' })}
            emptyText={t('vendors.detail.addVendorName', { ns: 'finance' })}
            ariaLabel={t('vendors.detail.vendorNameAria', { ns: 'finance' })}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Mail className='h-4 w-4 text-muted-foreground' />
          <InlineEdit
            value={vendor.email}
            onSave={(nextValue) => onSaveField('email', nextValue)}
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
              onSave={(nextValue) => onSaveField('account_number', nextValue)}
              placeholder={t('vendors.detail.accountNumberPlaceholder', { ns: 'finance' })}
              emptyText={t('vendors.detail.addAccountNumber', { ns: 'finance' })}
              ariaLabel={t('vendors.detail.accountNumberAria', { ns: 'finance' })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OrderRow({ order }: { order: VendorPurchaseOrderSummary }) {
  const { t } = useTranslation(['finance', 'common'])
  const navigate = useNavigate()
  const dateLabel = useDateLabel()
  const open = () => navigate(`/purchase-orders/${order.id}`)

  return (
    <TableRow
      className='cursor-pointer hover:bg-accent/50'
      onClick={open}
      tabIndex={0}
      role='button'
      aria-label={t('vendors.detail.openOrderAria', { ns: 'finance', number: order.order_number })}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      <TableCell className='font-medium'>{order.order_number}</TableCell>
      <TableCell>{dateLabel(order.createdAt)}</TableCell>
      <TableCell><StatusBadge status={order.status} /></TableCell>
      <TableCell className='text-right'>{formatCurrency(getPurchaseOrderTotal(order))}</TableCell>
    </TableRow>
  )
}

export function VendorOrdersTab({ orders }: { orders: VendorPurchaseOrderSummary[] }) {
  const { t } = useTranslation(['finance', 'common'])

  return (
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
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
            {orders.length === 0 && <EmptyRow colSpan={4}>{t('vendors.detail.noActiveOrders', { ns: 'finance' })}</EmptyRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function VendorInvoicesTab({ invoices }: { invoices: VendorPurchaseInvoiceSummary[] }) {
  const { t } = useTranslation(['finance', 'common'])
  const dateLabel = useDateLabel()

  return (
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
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className='font-medium'>
                  {invoice.invoice_number || invoice.vendor_invoice_number || t('vendors.detail.draftShort', { ns: 'finance' })}
                </TableCell>
                <TableCell>{dateLabel(invoice.invoice_date)}</TableCell>
                <TableCell><StatusBadge status={invoice.status} /></TableCell>
                <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_amount))}</TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && <EmptyRow colSpan={4}>{t('vendors.detail.noPurchaseInvoices', { ns: 'finance' })}</EmptyRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function VendorBrandsTab({
  vendor,
  brandIds,
  isUpdating,
  onChange,
}: {
  vendor: Vendor
  brandIds: number[]
  isUpdating: boolean
  onChange: (brandIds: number[]) => Promise<void>
}) {
  const { t } = useTranslation(['finance', 'common'])

  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base font-semibold flex items-center gap-2'>
          <Tags className='h-4 w-4' />
          {t('vendors.detail.tabs.supportedBrands', { ns: 'finance' })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <BrandMultiSelect
          value={brandIds}
          onChange={onChange}
          isUpdating={isUpdating}
          ariaLabel={t('vendors.detail.brandsAria', { ns: 'finance', name: vendor.name })}
        />
        <p className='text-xs text-muted-foreground mt-3'>{t('vendors.detail.brandsHint', { ns: 'finance' })}</p>
      </CardContent>
    </Card>
  )
}

function Amount({ value }: { value: string | number | null | undefined }) {
  return value != null ? <>{formatCurrency(toNumber(value))}</> : <MissingValue />
}

function ArticleRow({ article }: { article: VendorArticle }) {
  return (
    <TableRow>
      <TableCell className='font-mono font-medium text-xs'>{article.vendor_article_no}</TableCell>
      <TableCell>
        {article.catalog_item ? (
          <div className='flex items-center gap-2'>
            <span className='font-medium'>{article.catalog_item.name}</span>
            <span className='text-xs text-muted-foreground font-mono'>({article.catalog_item.sku})</span>
          </div>
        ) : (
          <MissingValue />
        )}
      </TableCell>
      <TableCell className='text-right'>
        <Amount value={article.last_cost} />
      </TableCell>
      <TableCell className='text-right'>
        <Amount value={article.last_rrp} />
      </TableCell>
    </TableRow>
  )
}

function ArticleRows({ articles, isLoading }: { articles: VendorArticle[]; isLoading: boolean }) {
  const { t } = useTranslation(['finance', 'common'])

  if (isLoading) return <EmptyRow colSpan={4}>{t('vendors.detail.loadingArticles', { ns: 'finance' })}</EmptyRow>
  if (articles.length === 0) return <EmptyRow colSpan={4}>{t('vendors.detail.noVendorArticles', { ns: 'finance' })}</EmptyRow>
  return articles.map((article) => <ArticleRow key={article.id} article={article} />)
}

export function VendorArticlesTab({ articles, isLoading }: { articles: VendorArticle[]; isLoading: boolean }) {
  const { t } = useTranslation(['finance', 'common'])

  return (
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
            <ArticleRows articles={articles} isLoading={isLoading} />
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
