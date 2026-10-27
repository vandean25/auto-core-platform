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
import { cn, formatCurrency } from '@/lib/utils'
import type { Invoice } from '@/api/types'
import type { GroupedCheckoutTask } from '../hooks/useWorkshopCalculations'

// Phone layout stacks the table cells, so headers move into a data-label prefix.
const mobileLabel =
  'max-md:before:mr-1.5 max-md:before:text-xs max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]'

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
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <CardTitle as='h3' className='text-base font-semibold'>{t('checkoutSummary.title')}</CardTitle>
            <p className='text-xs text-muted-foreground mt-1'>{t('checkoutSummary.hint')}</p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
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
                className='max-md:min-h-11'
                onClick={onCreateDraftInvoice}
                disabled={!canCreateDraftInCheckout || createDraftPending}
              >
                {createDraftPending ? t('checkoutSummary.creatingDraft') : t('checkoutSummary.createDraft')}
              </Button>
            )}
            {activeInvoiceId && fetchedInvoice?.status === 'DRAFT' && (
              <Button
                size='sm'
                className='max-md:min-h-11'
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
          <Table className='max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block max-md:[&_tr]:flex max-md:[&_tr]:flex-wrap max-md:[&_tr]:items-center max-md:[&_tr]:gap-x-4 max-md:[&_tr]:px-3 max-md:[&_tr]:py-2 max-md:[&_td]:p-0 max-md:[&_td]:py-1'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('checkoutSummary.colItem')}</TableHead>
                <TableHead className='text-right md:w-[90px]'>{t('checkoutSummary.colQty')}</TableHead>
                <TableHead className='text-right md:w-[140px]'>{t('checkoutSummary.colUnitPrice')}</TableHead>
                <TableHead className='text-right md:w-[260px]'>{t('checkoutSummary.colDiscount')}</TableHead>
                <TableHead className='text-right md:w-[160px]'>{t('checkoutSummary.colNet')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedCheckoutTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-center text-sm text-muted-foreground py-6 max-md:basis-full'>
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
                      <TableCell colSpan={3} className='max-md:basis-full'>
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
                              className='h-8 w-full min-w-0 text-right max-md:h-11 md:w-[110px]'
                              inputMode='decimal'
                              placeholder='0'
                              disabled={isLocked || lines.length === 0}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className='text-right font-semibold max-md:ml-auto'>
                        {formatCurrency(netTotal)}
                      </TableCell>
                    </TableRow>

                    {isExpanded && lines.map((line) => (
                      <TableRow key={line.rowKey}>
                        <TableCell className='max-md:basis-full'>
                          <div className='text-sm font-medium'>{line.lineItem.description}</div>
                          <div className='text-xs text-muted-foreground'>
                            {t('checkoutSummary.lineMeta', {
                              type: t(`taskLineEditor.type.${line.lineItem.type}`),
                              itemNo:
                                line.lineItem.itemNo || t('checkoutSummary.missingItemNo'),
                            })}
                          </div>
                        </TableCell>
                        <TableCell className={cn('text-right', mobileLabel)} data-label={t('checkoutSummary.colQty')}>{line.lineItem.qty}</TableCell>
                        <TableCell className={cn('text-right', mobileLabel)} data-label={t('checkoutSummary.colUnitPrice')}>
                          {formatCurrency(line.lineItem.unitPrice)}
                        </TableCell>
                        <TableCell className='max-md:order-last max-md:basis-full'>
                          <div className='flex justify-end gap-2'>
                            <Select
                              value={line.discount.type ?? 'NONE'}
                              onValueChange={(value) => onLineDiscountTypeChange(line.rowKey, value)}
                              disabled={isLocked}
                            >
                              <SelectTrigger className='h-8 w-full min-w-0 text-xs max-md:h-11 md:w-[110px]'>
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
                            className='h-8 w-full min-w-0 text-right max-md:h-11 md:w-[110px]'
                            inputMode='decimal'
                            placeholder='0'
                            disabled={isLocked}
                          />
                        </div>
                      </TableCell>
                      <TableCell className={cn('text-right font-medium max-md:ml-auto', mobileLabel)} data-label={t('checkoutSummary.colNet')}>
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
