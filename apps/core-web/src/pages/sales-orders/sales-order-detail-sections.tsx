import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { SalesOrder } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

export function SalesOrderCustomerCard({ customer }: { customer: SalesOrder['customer'] }) {
  const { t } = useTranslation('sales')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('orders.detail.customer')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-medium text-lg">
          {customer.type === 'COMPANY' ? customer.company_name : `${customer.first_name} ${customer.last_name}`}
        </div>
        <div className="text-sm text-muted-foreground mt-2">
          <div>{customer.email}</div>
          <div>{customer.phone}</div>
        </div>
        <div className="mt-4 pt-4 border-t text-sm">
          <div>{customer.address_street}</div>
          <div>
            {customer.address_zip} {customer.address_city}
          </div>
          <div>{customer.address_country}</div>
        </div>
        <Button variant="link" className="px-0 mt-2" asChild>
          <Link to={`/customers/${customer.id}`}>{t('orders.detail.viewProfile')}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function SalesOrderVehicleCard({ vehicle }: { vehicle: NonNullable<SalesOrder['vehicle']> }) {
  const { t } = useTranslation('sales')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('orders.detail.vehicle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-medium">
          {vehicle.make} {vehicle.model}
        </div>
        <div className="text-sm text-muted-foreground">{vehicle.year}</div>
        <div className="mt-2 text-sm">{t('orders.detail.vinLabel', { vin: vehicle.vin })}</div>
      </CardContent>
    </Card>
  )
}

export function SalesOrderNotesCard({
  notes,
  readOnly,
  onSave,
}: {
  notes: string | null | undefined
  readOnly: boolean
  onSave: (next: string) => Promise<void>
}) {
  const { t } = useTranslation('sales')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('orders.detail.notes')}</CardTitle>
      </CardHeader>
      <CardContent>
        <InlineEdit
          mode="textarea"
          rows={5}
          value={notes ?? ''}
          onSave={onSave}
          placeholder={t('orders.detail.notesPlaceholder')}
          emptyText={t('orders.detail.notesEmpty')}
          readOnly={readOnly}
          ariaLabel={t('orders.detail.notesAria')}
        />
      </CardContent>
    </Card>
  )
}

function SalesOrderItemRows({ items }: { items: SalesOrder['items'] }) {
  const { t } = useTranslation('sales')

  if (items.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
          {t('orders.detail.noItems')}
        </TableCell>
      </TableRow>
    )
  }

  return items.map((item) => (
    <TableRow key={item.id}>
      <TableCell>
        <div className="font-medium">{item.description}</div>
        <div className="text-xs text-muted-foreground">{item.catalog_item?.sku}</div>
      </TableCell>
      <TableCell>{Number(item.quantity)}</TableCell>
      <TableCell>{formatCurrency(Number(item.unit_price))}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(item.total))}</TableCell>
    </TableRow>
  ))
}

export function SalesOrderItemsCard({ order }: { order: SalesOrder }) {
  const { t } = useTranslation('sales')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('orders.detail.orderItems')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('orders.detail.columns.description')}</TableHead>
              <TableHead>{t('orders.detail.columns.qty')}</TableHead>
              <TableHead>{t('orders.detail.columns.price')}</TableHead>
              <TableHead className="text-right">{t('orders.detail.columns.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SalesOrderItemRows items={order.items} />
          </TableBody>
        </Table>
        <div className="p-4 flex justify-end items-center gap-4 border-t bg-muted/50">
          <span className="text-muted-foreground font-medium">{t('orders.detail.totalAmount')}</span>
          <span className="text-2xl font-bold">{formatCurrency(Number(order.total_amount))}</span>
        </div>
      </CardContent>
    </Card>
  )
}
