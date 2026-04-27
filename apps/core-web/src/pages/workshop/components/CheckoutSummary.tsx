import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
import type { Invoice } from '@/api/types'
import type { GroupedCheckoutTask } from '../hooks/useWorkshopCalculations'

export interface CheckoutSummaryProps {
  activeInvoiceId: string | null | undefined
  fetchedInvoice: Invoice | null | undefined
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
    <Card className='border-primary/20'>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between gap-3'>
          <div>
            <CardTitle className='text-base font-semibold'>Draft Invoice</CardTitle>
            <p className='text-xs text-muted-foreground mt-1'>
              Grouped by task. Use task-level discount (%) to cascade to every nested line.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {activeInvoiceId && (
              <span className='text-xs text-muted-foreground'>
                Invoice: {fetchedInvoice?.invoice_number || activeInvoiceId}
              </span>
            )}
            {canCreateDraftInCheckout && (
              <Button size='sm' onClick={onCreateDraftInvoice}>
                {createDraftPending ? 'Creating Draft...' : 'Create Draft Invoice'}
              </Button>
            )}
            {canIssueInvoiceInCheckout && (
              <Button size='sm' onClick={onIssueInvoice}>
                {issuePending ? 'Issuing...' : 'Issue Invoice'}
              </Button>
            )}
            {activeInvoiceId && isInvoiceLoading && (
              <span className='text-xs text-muted-foreground'>Loading invoice...</span>
            )}
            <Button variant='outline' size='sm' onClick={onReturnToTasks}>
              Return to Tasks
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='rounded-xl border overflow-hidden'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className='text-right w-[90px]'>Qty</TableHead>
                <TableHead className='text-right w-[140px]'>Unit Price</TableHead>
                <TableHead className='text-right w-[260px]'>Discount</TableHead>
                <TableHead className='text-right w-[160px]'>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedCheckoutTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-center text-sm text-muted-foreground py-6'>
                    No billable lines found in tasks.
                  </TableCell>
                </TableRow>
              )}
              {groupedCheckoutTasks.map(({ task, lines, netTotal }) => {
                const taskDiscountPercent = taskDiscountOverrides[task.id] ?? ''
                const isExpanded = expandedTaskGroups[task.id] === true
                return (
                  <Fragment key={task.id}>
                    <TableRow className='bg-muted/40'>
                      <TableCell colSpan={3}>
                        <div className='flex items-center justify-between gap-2'>
                          <button
                            type='button'
                            className='flex items-center gap-2 text-left'
                            onClick={() => onToggleGroup(task.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className='h-4 w-4 text-muted-foreground' />
                            ) : (
                              <ChevronRight className='h-4 w-4 text-muted-foreground' />
                            )}
                            <span className='font-semibold'>{task.title}</span>
                          </button>
                          {!isLocked && (
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-7 px-2'
                              onClick={() => onReopenTask(task.id)}
                            >
                              Reopen Task
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex justify-end'>
                          <div className='flex items-center gap-2'>
                            <span className='text-[11px] text-muted-foreground whitespace-nowrap'>Discount Whole Task (%)</span>
                            <Input
                              value={taskDiscountPercent}
                              onChange={(e) => onTaskDiscountValueChange(task.id, e.target.value)}
                              className='h-8 w-[110px] text-right'
                              inputMode='decimal'
                              placeholder='0'
                              disabled={isLocked || lines.length === 0}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className='text-right font-semibold'>
                        {formatCurrency(netTotal)}
                      </TableCell>
                    </TableRow>

                    {isExpanded && lines.map((line) => (
                      <TableRow key={line.rowKey}>
                        <TableCell>
                          <div className='text-sm font-medium'>{line.lineItem.description}</div>
                          <div className='text-xs text-muted-foreground'>
                            {line.lineItem.type} • {line.lineItem.itemNo || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className='text-right'>{line.lineItem.qty}</TableCell>
                        <TableCell className='text-right'>
                          {formatCurrency(line.lineItem.unitPrice)}
                        </TableCell>
                        <TableCell>
                          <div className='flex justify-end gap-2'>
                            <Select
                              value={line.discount.type ?? 'NONE'}
                              onValueChange={(value) => onLineDiscountTypeChange(line.rowKey, value)}
                              disabled={isLocked}
                            >
                              <SelectTrigger className='h-8 w-[110px] text-xs'>
                                <SelectValue placeholder='No discount' />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='NONE'>None</SelectItem>
                                <SelectItem value='PERCENTAGE'>%</SelectItem>
                                <SelectItem value='FLAT_AMOUNT'>EUR</SelectItem>
                              </SelectContent>
                            </Select>
                          <Input
                            value={line.discount.value}
                            onChange={(e) => onLineDiscountValueChange(line.rowKey, e.target.value)}
                            className='h-8 w-[110px] text-right'
                            inputMode='decimal'
                            placeholder='0'
                            disabled={isLocked}
                          />
                        </div>
                      </TableCell>
                      <TableCell className='text-right font-medium'>
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

        <div className='flex justify-end'>
          <div className='w-full max-w-md rounded-xl border bg-muted/20 p-4 space-y-2'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Subtotal</span>
              <span>{formatCurrency(checkoutSubtotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Total Discounts</span>
              <span>-{formatCurrency(checkoutDiscountTotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Net</span>
              <span>{formatCurrency(checkoutNetTotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>VAT</span>
              <span>{formatCurrency(checkoutTaxTotal)}</span>
            </div>
            <div className='border-t pt-2 mt-2 flex items-center justify-between text-sm font-semibold'>
              <span>Total</span>
              <span>{formatCurrency(checkoutGrossTotal)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
