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
  children: ReactNode
}

/** Card with a table whose last column is right-aligned and an empty-state row. */
function RecordTable({ headers, emptyText, isEmpty, children }: RecordTableProps) {
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
      <TabsList>
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
        >
          {workshopOrders.map((order) => (
            <ServiceOrderTableRow key={order.id} order={order} />
          ))}
        </RecordTable>
      </TabsContent>
    </Tabs>
  )
}
