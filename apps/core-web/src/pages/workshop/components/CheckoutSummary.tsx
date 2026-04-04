import { Fragment } from 'react'
import { ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import type { GroupedCheckoutTask } from '../hooks/useWorkshopCalculations'

export interface CheckoutSummaryProps {
  activeInvoiceId: string | null | undefined
  fetchedInvoice: any
  isInvoiceLoading: boolean
  isLocked: boolean
  canCreateDraftInCheckout: boolean
  canIssueInvoiceInCheckout: boolean
  createDraftPending: boolean
  issuePending: boolean
  groupedCheckoutTasks: GroupedCheckoutTask[]
  expandedTaskGroups: Record<string, boolean>
  taskDiscountOverrides: Record<string, string>
  checkoutSubtotal: number
  checkoutDiscountTotal: number
  checkoutNetTotal: number
  checkoutTaxTotal: number
  checkoutGrossTotal: number
  onToggleGroup: (taskId: string) => void
  onTaskDiscountValueChange: (taskId: string, value: string) => void
  onLineDiscountTypeChange: (rowKey: string, value: string) => void
  onLineDiscountValueChange: (rowKey: string, value: string) => void
  onCreateDraftInvoice: () => void
  onIssueInvoice: () => void
  onReturnToTasks: () => void
  onReopenTask: (taskId: string) => void
}

export function CheckoutSummary({
  activeInvoiceId,
  fetchedInvoice,
  isInvoiceLoading,
  isLocked,
  canCreateDraftInCheckout,
  canIssueInvoiceInCheckout,
  createDraftPending,
  issuePending,
  groupedCheckoutTasks,
  expandedTaskGroups,
  taskDiscountOverrides,
  checkoutSubtotal,
  checkoutDiscountTotal,
  checkoutNetTotal,
  checkoutTaxTotal,
  checkoutGrossTotal,
  onToggleGroup,
  onTaskDiscountValueChange,
  onLineDiscountTypeChange,
  onLineDiscountValueChange,
  onCreateDraftInvoice,
  onIssueInvoice,
  onReturnToTasks,
  onReopenTask,
}: CheckoutSummaryProps) {
  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg font-semibold">Checkout</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Review line items and apply discounts before invoicing
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeInvoiceId && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                  Invoice: {fetchedInvoice?.invoice_number || activeInvoiceId}
                </span>
              )}
              {canCreateDraftInCheckout && (
                <Button size="sm" onClick={onCreateDraftInvoice} disabled={createDraftPending}>
                  {createDraftPending ? 'Creating...' : 'Create Draft Invoice'}
                </Button>
              )}
              {canIssueInvoiceInCheckout && (
                <Button size="sm" onClick={onIssueInvoice} disabled={issuePending}>
                  {issuePending ? 'Issuing...' : 'Issue Invoice'}
                </Button>
              )}
              {activeInvoiceId && isInvoiceLoading && (
                <span className="text-xs text-muted-foreground">Loading...</span>
              )}
              <Button variant="outline" size="sm" onClick={onReturnToTasks}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Return to Tasks
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Line Items Table */}
      <Card>
        <CardContent className="p-0">
          <div className="rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-semibold">Item</TableHead>
                  <TableHead className="text-right w-[80px] font-semibold">Qty</TableHead>
                  <TableHead className="text-right w-[120px] font-semibold">Unit Price</TableHead>
                  <TableHead className="text-right w-[260px] font-semibold">Discount</TableHead>
                  <TableHead className="text-right w-[140px] font-semibold">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedCheckoutTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-12">
                      No billable line items found in tasks.
                    </TableCell>
                  </TableRow>
                )}
                {groupedCheckoutTasks.map(({ task, lines, discountTotal, netTotal }) => {
                  const taskDiscountPercent = taskDiscountOverrides[task.id] ?? ''
                  const isExpanded = expandedTaskGroups[task.id] === true
                  return (
                    <Fragment key={task.id}>
                      {/* Task Group Header */}
                      <TableRow className="bg-muted/20 hover:bg-muted/30">
                        <TableCell colSpan={2}>
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left font-medium"
                              onClick={() => onToggleGroup(task.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span>{task.title}</span>
                              <span className="text-xs text-muted-foreground font-normal">
                                ({lines.length} items)
                              </span>
                            </button>
                            {!isLocked && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => onReopenTask(task.id)}
                              >
                                Edit Task
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(netTotal)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                Task Discount %
                              </span>
                              <Input
                                value={taskDiscountPercent}
                                onChange={(e) => onTaskDiscountValueChange(task.id, e.target.value)}
                                className="h-8 w-[80px] text-right text-sm"
                                inputMode="decimal"
                                placeholder="0"
                                disabled={isLocked || lines.length === 0}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          -{formatCurrency(discountTotal)}
                        </TableCell>
                      </TableRow>

                      {/* Expanded Line Items */}
                      {isExpanded && lines.map((line) => (
                        <TableRow key={line.rowKey} className="bg-background">
                          <TableCell className="pl-10">
                            <div className="text-sm">{line.lineItem.description}</div>
                            <div className="text-xs text-muted-foreground">
                              {line.lineItem.type} - {line.lineItem.itemNo || 'N/A'}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{line.lineItem.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(line.lineItem.unitPrice)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Select
                                value={line.discount.type ?? 'NONE'}
                                onValueChange={(value) => onLineDiscountTypeChange(line.rowKey, value)}
                                disabled={isLocked}
                              >
                                <SelectTrigger className="h-8 w-[90px] text-xs">
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NONE">None</SelectItem>
                                  <SelectItem value="PERCENTAGE">%</SelectItem>
                                  <SelectItem value="FLAT_AMOUNT">EUR</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                value={line.discount.value}
                                onChange={(e) => onLineDiscountValueChange(line.rowKey, e.target.value)}
                                className="h-8 w-[80px] text-right text-sm"
                                inputMode="decimal"
                                placeholder="0"
                                disabled={isLocked}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(line.lineNet)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Totals Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-end">
            <div className="w-full max-w-sm space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(checkoutSubtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Discounts</span>
                <span className="tabular-nums text-green-600">-{formatCurrency(checkoutDiscountTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Net</span>
                <span className="tabular-nums">{formatCurrency(checkoutNetTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">VAT</span>
                <span className="tabular-nums">{formatCurrency(checkoutTaxTotal)}</span>
              </div>
              <div className="border-t pt-3 mt-3 flex items-center justify-between">
                <span className="text-base font-semibold">Total</span>
                <span className="text-xl font-bold text-primary tabular-nums">{formatCurrency(checkoutGrossTotal)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
