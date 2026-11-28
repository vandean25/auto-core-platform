import type { KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatCurrency } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import {
  getActiveOrders,
  getWorkshopOrderTotal,
  toNumber,
  type ActiveOrderRow,
  type VehicleDetailResponse,
  type VehicleInvoiceSummary,
  type VehicleWorkshopOrderSummary,
} from './vehicle-detail-model'

type RecordTableProps = {
  headers: string[]
  emptyText: string
  isEmpty: boolean
  mobileItems?: ReactNode
  children: ReactNode
}

/** Card with a table whose last column is right-aligned and an empty-state row (card list on phones). */
function RecordTable({ headers, emptyText, isEmpty, mobileItems, children }: RecordTableProps) {
  const isMobile = useIsMobile()

  if (isMobile && mobileItems !== undefined) {
    return (
      <Card>
        <CardContent className='p-0'>
          {isEmpty ? (
            <p className='py-4 text-center text-sm text-muted-foreground'>{emptyText}</p>
          ) : (
            <ul className='divide-y divide-border'>{mobileItems}</ul>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className='p-0'>
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead key={header} className={index === headers.length - 1 ? 'text-right' : undefined}>
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {children}
            {isEmpty && (
              <TableRow>
                <TableCell colSpan={headers.length} className='text-center py-4 text-muted-foreground'>
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

type MobileOrderCardProps = {
  to: string
  ariaLabel: string
  title: string
  subtitle: string
  status: string
  total: string
}

function MobileOrderCard({ to, ariaLabel, title, subtitle, status, total }: MobileOrderCardProps) {
  const navigate = useNavigate()
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigate(to)
    }
  }

  return (
    <li>
      <div
        role='button'
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={() => navigate(to)}
        onKeyDown={handleKeyDown}
        className='flex min-h-14 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/50'
      >
        <div className='min-w-0 flex-1'>
          <div className='break-words font-medium'>{title}</div>
          <div className='text-sm text-muted-foreground'>{subtitle}</div>
        </div>
        <div className='flex shrink-0 flex-col items-end gap-1'>
          <StatusBadge status={status} className='whitespace-nowrap' />
          <div className='text-sm tabular-nums text-muted-foreground'>{total}</div>
        </div>
      </div>
    </li>
  )
}

type NavigableRowProps = {
  to: string
  ariaLabel: string
  children: ReactNode
}

function NavigableRow({ to, ariaLabel, children }: NavigableRowProps) {
  const navigate = useNavigate()
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigate(to)
    }
  }

  return (
    <TableRow
      className='cursor-pointer hover:bg-accent/50'
      onClick={() => navigate(to)}
      tabIndex={0}
      role='button'
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {children}
    </TableRow>
  )
}

function ActiveOrderTableRow({ order }: { order: ActiveOrderRow }) {
  const { t } = useTranslation('vehicles')
  const isService = order.type === 'Service'

  return (
    <NavigableRow
      to={isService ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`}
      ariaLabel={
        isService
          ? t('detail.aria.openServiceOrder', { number: order.number })
          : t('detail.aria.openSalesOrder', { number: order.number })
      }
    >
      <TableCell className='font-medium'>{order.number}</TableCell>
      <TableCell>{t(isService ? 'detail.orderTypes.service' : 'detail.orderTypes.sales')}</TableCell>
      <TableCell>{formatDate(order.createdAt)}</TableCell>
      <TableCell><StatusBadge status={order.status} /></TableCell>
      <TableCell className='text-right'>{formatCurrency(order.total)}</TableCell>
    </NavigableRow>
  )
}

function InvoiceTableRow({ invoice }: { invoice: VehicleInvoiceSummary }) {
  const { t } = useTranslation('vehicles')

  return (
    <NavigableRow
      to={`/sales/invoices/${invoice.id}`}
      ariaLabel={t('detail.aria.openInvoice', { number: invoice.invoice_number || invoice.id })}
    >
      <TableCell className='font-medium'>{invoice.invoice_number || t('shared.draft')}</TableCell>
      <TableCell>{formatDate(invoice.date)}</TableCell>
      <TableCell><StatusBadge status={invoice.status} /></TableCell>
      <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
    </NavigableRow>
  )
}

function ServiceOrderTableRow({ order }: { order: VehicleWorkshopOrderSummary }) {
  const { t } = useTranslation('vehicles')

  return (
    <NavigableRow
      to={`/workshop/orders/${order.id}`}
      ariaLabel={t('detail.aria.openServiceOrder', { number: order.order_number ?? order.id })}
    >
      <TableCell className='font-medium'>{order.order_number ?? `#${order.id}`}</TableCell>
      <TableCell>{formatDate(order.createdAt)}</TableCell>
      <TableCell><StatusBadge status={order.status} /></TableCell>
      <TableCell className='text-right'>{formatCurrency(getWorkshopOrderTotal(order))}</TableCell>
    </NavigableRow>
  )
}

export function VehicleOrderTabs({ vehicle }: { vehicle: VehicleDetailResponse }) {
  const { t } = useTranslation('vehicles')
  const activeOrders = getActiveOrders(vehicle)
  const invoices = vehicle.invoices ?? []
  const workshopOrders = vehicle.workshop_orders ?? []

  return (
    <Tabs defaultValue='orders'>
      <TabsList className='h-auto min-h-9 flex-wrap gap-1 max-sm:flex max-sm:w-full max-sm:justify-start max-sm:[&_[role=tab]]:min-h-11 max-sm:[&_[role=tab]]:shrink-0'>
        <TabsTrigger value='orders'>{t('detail.tabs.activeOrders')}</TabsTrigger>
        <TabsTrigger value='invoices'>{t('detail.tabs.invoiceHistory')}</TabsTrigger>
        <TabsTrigger value='service'>{t('detail.tabs.serviceOrders')}</TabsTrigger>
      </TabsList>

      <TabsContent value='orders' className='mt-4'>
        <RecordTable
          headers={[
            t('detail.tables.orderNumber'),
            t('detail.tables.type'),
            t('detail.tables.date'),
            t('detail.tables.status'),
            t('detail.tables.total'),
          ]}
          emptyText={t('detail.tables.noActiveOrders')}
          isEmpty={activeOrders.length === 0}
          mobileItems={activeOrders.map((order) => {
            const isService = order.type === 'Service'
            return (
              <MobileOrderCard
                key={`${order.type}-${order.id}`}
                to={isService ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`}
                ariaLabel={
                  isService
                    ? t('detail.aria.openServiceOrder', { number: order.number })
                    : t('detail.aria.openSalesOrder', { number: order.number })
                }
                title={order.number}
                subtitle={`${t(isService ? 'detail.orderTypes.service' : 'detail.orderTypes.sales')} · ${formatDate(order.createdAt)}`}
                status={order.status}
                total={formatCurrency(order.total)}
              />
            )
          })}
        >
          {activeOrders.map((order) => (
            <ActiveOrderTableRow key={`${order.type}-${order.id}`} order={order} />
          ))}
        </RecordTable>
      </TabsContent>

      <TabsContent value='invoices' className='mt-4'>
        <RecordTable
          headers={[
            t('detail.tables.invoiceNumber'),
            t('detail.tables.date'),
            t('detail.tables.status'),
            t('detail.tables.total'),
          ]}
          emptyText={t('detail.tables.noInvoices')}
          isEmpty={invoices.length === 0}
          mobileItems={invoices.map((invoice) => (
            <MobileOrderCard
              key={invoice.id}
              to={`/sales/invoices/${invoice.id}`}
              ariaLabel={t('detail.aria.openInvoice', { number: invoice.invoice_number || invoice.id })}
              title={invoice.invoice_number || t('shared.draft')}
              subtitle={formatDate(invoice.date)}
              status={invoice.status}
              total={formatCurrency(toNumber(invoice.total_gross))}
            />
          ))}
        >
          {invoices.map((invoice) => (
            <InvoiceTableRow key={invoice.id} invoice={invoice} />
          ))}
        </RecordTable>
      </TabsContent>

      <TabsContent value='service' className='mt-4'>
        <RecordTable
          headers={[
            t('detail.tables.serviceOrderNumber'),
            t('detail.tables.date'),
            t('detail.tables.status'),
            t('detail.tables.total'),
          ]}
          emptyText={t('detail.tables.noServiceOrders')}
          isEmpty={workshopOrders.length === 0}
          mobileItems={workshopOrders.map((order) => (
            <MobileOrderCard
              key={order.id}
              to={`/workshop/orders/${order.id}`}
              ariaLabel={t('detail.aria.openServiceOrder', { number: order.order_number ?? order.id })}
              title={order.order_number ?? `#${order.id}`}
              subtitle={formatDate(order.createdAt)}
              status={order.status}
              total={formatCurrency(getWorkshopOrderTotal(order))}
            />
          ))}
        >
          {workshopOrders.map((order) => (
            <ServiceOrderTableRow key={order.id} order={order} />
          ))}
        </RecordTable>
      </TabsContent>
    </Tabs>
  )
}
