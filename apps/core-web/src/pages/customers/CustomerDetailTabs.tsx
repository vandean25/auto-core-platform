import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { formatDate } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import type { Vehicle } from '@/api/types'
import { CustomerConsentPanel } from './CustomerConsentPanel'
import {
  getActiveOrders,
  toNumber,
  type CustomerDetailResponse,
  type InvoiceSummary,
} from './customer-detail-model'

function ClickableRow({ to, ariaLabel, children }: { to: string; ariaLabel: string; children: ReactNode }) {
  const navigate = useNavigate()

  return (
    <TableRow
      className='cursor-pointer hover:bg-accent/50'
      onClick={() => navigate(to)}
      tabIndex={0}
      role='button'
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(to)
        }
      }}
    >
      {children}
    </TableRow>
  )
}

function ActiveOrdersTable({ customer }: { customer: CustomerDetailResponse }) {
  const { t } = useTranslation('customers')
  const activeOrders = getActiveOrders(customer)

  return (
    <Card>
      <CardContent className='p-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.tables.orderNumber')}</TableHead>
              <TableHead>{t('detail.tables.type')}</TableHead>
              <TableHead>{t('detail.tables.date')}</TableHead>
              <TableHead>{t('detail.tables.status')}</TableHead>
              <TableHead className='text-right'>{t('detail.tables.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeOrders.map((order) => (
              <ClickableRow
                key={`${order.type}-${order.id}`}
                to={order.type === 'Service' ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`}
                ariaLabel={
                  order.type === 'Service'
                    ? t('detail.aria.openServiceOrder', { number: order.number })
                    : t('detail.aria.openSalesOrder', { number: order.number })
                }
              >
                <TableCell className='font-medium'>{order.number}</TableCell>
                <TableCell>{t(order.type === 'Sales' ? 'detail.orderTypes.sales' : 'detail.orderTypes.service')}</TableCell>
                <TableCell>{formatDate(order.createdAt)}</TableCell>
                <TableCell><StatusBadge status={order.status} /></TableCell>
                <TableCell className='text-right'>{formatCurrency(order.total)}</TableCell>
              </ClickableRow>
            ))}
            {activeOrders.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noActiveOrders')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function InvoicesTable({ invoices }: { invoices: InvoiceSummary[] }) {
  const { t } = useTranslation('customers')

  return (
    <Card>
      <CardContent className='p-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.tables.invoiceNumber')}</TableHead>
              <TableHead>{t('detail.tables.date')}</TableHead>
              <TableHead>{t('detail.tables.status')}</TableHead>
              <TableHead className='text-right'>{t('detail.tables.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <ClickableRow
                key={invoice.id}
                to={`/sales/invoices/${invoice.id}`}
                ariaLabel={t('detail.aria.openInvoice', {
                  number: invoice.invoice_number || invoice.id,
                })}
              >
                <TableCell className='font-medium'>{invoice.invoice_number || t('detail.tables.invoiceDraft')}</TableCell>
                <TableCell>{formatDate(invoice.date)}</TableCell>
                <TableCell><StatusBadge status={invoice.status} /></TableCell>
                <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
              </ClickableRow>
            ))}
            {invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noRecentInvoices')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function VehiclesTable({ vehicles }: { vehicles: Vehicle[] }) {
  const { t } = useTranslation('customers')
  const notAvailable = t('detail.notAvailable')

  return (
    <Card>
      <CardContent className='p-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('detail.tables.makeModel')}</TableHead>
              <TableHead>{t('detail.tables.year')}</TableHead>
              <TableHead>{t('detail.tables.vin')}</TableHead>
              <TableHead>{t('detail.tables.plate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((vehicle) => (
              <ClickableRow
                key={vehicle.id}
                to={`/vehicles/${vehicle.id}`}
                ariaLabel={t('detail.aria.openVehicle', {
                  make: vehicle.make,
                  model: vehicle.model,
                })}
              >
                <TableCell className='font-medium'>{vehicle.make} {vehicle.model}</TableCell>
                <TableCell>{vehicle.year}</TableCell>
                <TableCell>{vehicle.vin || notAvailable}</TableCell>
                <TableCell>{vehicle.plate || notAvailable}</TableCell>
              </ClickableRow>
            ))}
            {vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noVehiclesRegistered')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function CustomerDetailTabs({ customer }: { customer: CustomerDetailResponse }) {
  const { t } = useTranslation('customers')

  return (
    <Tabs defaultValue='orders'>
      <TabsList className='flex h-auto min-h-9 w-full flex-wrap gap-1'>
        <TabsTrigger value='orders'>{t('detail.tabs.activeOrders')}</TabsTrigger>
        <TabsTrigger value='invoices'>{t('detail.tabs.invoices')}</TabsTrigger>
        <TabsTrigger value='vehicles'>{t('detail.tabs.vehicles')}</TabsTrigger>
        <TabsTrigger value='consent'>{t('consent.tab')}</TabsTrigger>
      </TabsList>

      <TabsContent value='orders' className='mt-4'>
        <ActiveOrdersTable customer={customer} />
      </TabsContent>

      <TabsContent value='invoices' className='mt-4'>
        <InvoicesTable invoices={customer.invoices ?? []} />
      </TabsContent>

      <TabsContent value='vehicles' className='mt-4'>
        <VehiclesTable vehicles={customer.vehicles ?? []} />
      </TabsContent>

      <TabsContent value='consent' className='mt-4'>
        <CustomerConsentPanel customerId={customer.id} contactEmail={customer.email} />
      </TabsContent>
    </Tabs>
  )
}
