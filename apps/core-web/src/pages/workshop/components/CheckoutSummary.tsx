import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
  invoiceWarning?: ReactNode
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
  onReopenTask: (taskId: string) => void
}

export function CheckoutSummary({
  activeInvoiceId,
  fetchedInvoice,
  isInvoiceLoading,
  isLocked,
  canCreateDraftInCheckout,
  canIssueInvoiceInCheckout,
  invoiceWarning,
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
  onReopenTask,
}: CheckoutSummaryProps) {
  const { t } = useTranslation('workshop')

  return (
    <Card className='border-primary/20'>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between gap-3'>
          <div>
            <CardTitle as='h3' className='text-base font-semibold'>{t('checkoutSummary.title')}</CardTitle>
            <p className='text-xs text-muted-foreground mt-1'>{t('checkoutSummary.hint')}</p>
          </div>
          <div className='flex items-center gap-2'>
            {activeInvoiceId && (
              <span className='text-xs text-muted-foreground'>
                {t('checkoutSummary.invoiceLabel', {
                  number: fetchedInvoice?.invoice_number || activeInvoiceId,
                })}
              </span>
            )}
            {!activeInvoiceId && (
              <Button
                size='sm'
                onClick={onCreateDraftInvoice}
                disabled={!canCreateDraftInCheckout || createDraftPending}
              >
                {createDraftPending ? t('checkoutSummary.creatingDraft') : t('checkoutSummary.createDraft')}
              </Button>
            )}
            {activeInvoiceId && fetchedInvoice?.status === 'DRAFT' && (
              <Button
                size='sm'
                onClick={onIssueInvoice}
                disabled={!canIssueInvoiceInCheckout || issuePending}
              >
                {issuePending ? t('checkoutSummary.issuing') : t('checkoutSummary.issue')}
              </Button>
            )}
            {activeInvoiceId && isInvoiceLoading && (
              <span className='text-xs text-muted-foreground'>{t('checkoutSummary.loadingInvoice')}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {invoiceWarning}
        <div className='rounded-xl border overflow-hidden'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('checkoutSummary.colItem')}</TableHead>
                <TableHead className='text-right w-[90px]'>{t('checkoutSummary.colQty')}</TableHead>
                <TableHead className='text-right w-[140px]'>{t('checkoutSummary.colUnitPrice')}</TableHead>
                <TableHead className='text-right w-[260px]'>{t('checkoutSummary.colDiscount')}</TableHead>
                <TableHead className='text-right w-[160px]'>{t('checkoutSummary.colNet')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedCheckoutTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-center text-sm text-muted-foreground py-6'>
                    {t('checkoutSummary.empty')}
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
                          <div className='flex items-center gap-1'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7'
                              aria-label={
                                isExpanded
                                  ? t('checkoutSummary.collapse', { task: task.title })
                                  : t('checkoutSummary.expand', { task: task.title })
                              }
                              onClick={() => onToggleGroup(task.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className='h-4 w-4 text-muted-foreground' />
                              ) : (
                                <ChevronRight className='h-4 w-4 text-muted-foreground' />
                              )}
                            </Button>
                            <button
                              type='button'
                              className='font-semibold text-left'
                              onClick={() => onReopenTask(task.id)}
                            >
                              {task.title}
                            </button>
                          </div>
                          {!isLocked && (
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-7 px-2'
                              onClick={() => onReopenTask(task.id)}
                            >
                              {t('checkoutSummary.reopenTask')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex justify-end'>
                          <div className='flex items-center gap-2'>
                            <span className='text-[11px] text-muted-foreground whitespace-nowrap'>
                              {t('checkoutSummary.taskDiscount')}
                            </span>
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
                                <SelectValue placeholder={t('checkoutSummary.noDiscount')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='NONE'>{t('checkoutSummary.discountNone')}</SelectItem>
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
              <span className='text-muted-foreground'>{t('checkoutSummary.subtotal')}</span>
              <span>{formatCurrency(checkoutSubtotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>{t('checkoutSummary.totalDiscounts')}</span>
              <span>-{formatCurrency(checkoutDiscountTotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>{t('checkoutSummary.net')}</span>
              <span>{formatCurrency(checkoutNetTotal)}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>{t('checkoutSummary.vat')}</span>
              <span>{formatCurrency(checkoutTaxTotal)}</span>
            </div>
            <div className='border-t pt-2 mt-2 flex items-center justify-between text-sm font-semibold'>
              <span>{t('checkoutSummary.total')}</span>
              <span>{formatCurrency(checkoutGrossTotal)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
