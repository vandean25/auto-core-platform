import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Invoice } from '@/api/types'
import type { GroupedCheckoutTask } from '../hooks/useWorkshopCalculations'
import { formatCurrency } from '@/lib/utils'
import { CheckoutSummary } from './CheckoutSummary'

export interface CheckoutFooterProps {
  checkoutFooterTotal: number
  isCheckoutOpen: boolean
  primaryActionLabel: string
  onPrimaryAction: () => void
  onClose: () => void
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
  onReopenTask: (taskId: string) => void
}

export function CheckoutFooter({
  checkoutFooterTotal,
  isCheckoutOpen,
  primaryActionLabel,
  onPrimaryAction,
  onClose,
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
  onReopenTask,
}: CheckoutFooterProps) {
  return (
    <section className='sticky bottom-0 z-20 -mx-6 border-t bg-background/95 px-6 pb-4 pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <div className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Grand total
          </div>
          <div className='text-xl font-semibold tracking-tight'>
            {formatCurrency(checkoutFooterTotal)}
          </div>
        </div>
        <Button onClick={onPrimaryAction}>{primaryActionLabel}</Button>
      </div>

      {isCheckoutOpen && (
        <div className='mt-4 border-t pt-4'>
          <div className='mb-3 flex items-center justify-between gap-3'>
            <div>
              <h2 className='text-lg font-semibold tracking-tight'>Checkout</h2>
              <p className='text-xs text-muted-foreground'>
                Review discounts and issue the invoice without leaving this job.
              </p>
            </div>
            <Button variant='outline' size='sm' onClick={onClose}>
              <X className='mr-1.5 h-4 w-4' />
              Close Checkout
            </Button>
          </div>
          <CheckoutSummary
            activeInvoiceId={activeInvoiceId}
            fetchedInvoice={fetchedInvoice}
            isInvoiceLoading={isInvoiceLoading}
            isLocked={isLocked}
            canCreateDraftInCheckout={canCreateDraftInCheckout}
            canIssueInvoiceInCheckout={canIssueInvoiceInCheckout}
            createDraftPending={createDraftPending}
            issuePending={issuePending}
            groupedCheckoutTasks={groupedCheckoutTasks}
            expandedTaskGroups={expandedTaskGroups}
            taskDiscountOverrides={taskDiscountOverrides}
            checkoutSubtotal={checkoutSubtotal}
            checkoutDiscountTotal={checkoutDiscountTotal}
            checkoutNetTotal={checkoutNetTotal}
            checkoutTaxTotal={checkoutTaxTotal}
            checkoutGrossTotal={checkoutGrossTotal}
            onToggleGroup={onToggleGroup}
            onTaskDiscountValueChange={onTaskDiscountValueChange}
            onLineDiscountTypeChange={onLineDiscountTypeChange}
            onLineDiscountValueChange={onLineDiscountValueChange}
            onCreateDraftInvoice={onCreateDraftInvoice}
            onIssueInvoice={onIssueInvoice}
            onReopenTask={onReopenTask}
          />
        </div>
      )}
    </section>
  )
}
