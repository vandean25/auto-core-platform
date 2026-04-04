import { Package, Clock3, CircleDollarSign, Printer, FileText, Car, User2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { ActionGroup } from '@/components/ui/action-group'
import { formatCurrency } from '@/lib/utils'

function getCustomerName(order: any) {
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }
  return `${order.customer.first_name} ${order.customer.last_name}`.trim()
}

function getVehicleLabel(order: any) {
  return `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`
}

export interface OrderHeaderProps {
  order: any
  orderPartsTotal: number
  orderLaborTotal: number
  orderGrandTotal: number
  invoiceActionLabel: string
  isInvoiceActionDisabled: boolean
  onCheckoutAction: () => void
  onPrint: () => void
}

export function OrderHeader({
  order,
  orderPartsTotal,
  orderLaborTotal,
  orderGrandTotal,
  invoiceActionLabel,
  isInvoiceActionDisabled,
  onCheckoutAction,
  onPrint,
}: OrderHeaderProps) {
  const customerName = getCustomerName(order)
  const vehicleLabel = getVehicleLabel(order)

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Top section with order info and actions */}
        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            {/* Left: Order info */}
            <div className="space-y-3 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{order.order_number ?? `#${order.id}`}</h1>
                <StatusBadge status={order.status} />
                <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300">
                  Waiter
                </Badge>
              </div>

              {/* Quick info row */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <User2 className="h-4 w-4" />
                  {customerName}
                </span>
                <span className="flex items-center gap-1.5">
                  <Car className="h-4 w-4" />
                  {vehicleLabel}
                </span>
                {order.vehicle.plate && (
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {order.vehicle.plate}
                  </span>
                )}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {!isInvoiceActionDisabled ? (
                <ActionGroup
                  primaryAction={
                    <Button onClick={onCheckoutAction} size="sm" className="h-9">
                      <FileText className="h-4 w-4 mr-2" />
                      {invoiceActionLabel}
                    </Button>
                  }
                  secondaryActions={[
                    {
                      label: 'Print Job Card',
                      icon: <Printer className="h-4 w-4" />,
                      onClick: onPrint,
                    },
                  ]}
                />
              ) : (
                <Button variant="outline" size="sm" className="h-9" onClick={onPrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print Job Card
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Bottom section with totals */}
        <div className="border-t bg-muted/20 px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Package className="h-3.5 w-3.5" />
                  <span>Parts</span>
                </div>
                <span className="text-sm font-medium">{formatCurrency(orderPartsTotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>Labor</span>
                </div>
                <span className="text-sm font-medium">{formatCurrency(orderLaborTotal)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-primary/80">
                <CircleDollarSign className="h-4 w-4" />
                <span>Grand Total</span>
              </div>
              <span className="text-lg font-bold text-primary">{formatCurrency(orderGrandTotal)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
