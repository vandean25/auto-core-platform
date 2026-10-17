import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuthSession } from '@/api/auth-session'
import { useWorkshopOrderEstimate } from '@/api/workshop-estimates'
import { canManageWorkshopEstimates } from '@/features/workshop/workshop-estimate-permissions'
import { formatEstimateMoney } from '@/features/workshop/workshop-estimate-decision'

export interface InvoiceOverrunWarningProps {
  orderId: string
  /** True while an invoice draft on this order can be issued from the page. Nothing is warned about once it is issued. */
  canIssueInvoice: boolean
}

/**
 * Warning at invoice finalisation (AUT-355, ADR-0025 §1): the order is above the approved estimate and the customer has
 * not been told about it. It shows only while an invoice draft can be issued, and only to the roles that read estimates.
 * It is a warning only, so the invoice can still be issued.
 */
export function InvoiceOverrunWarning({ orderId, canIssueInvoice }: InvoiceOverrunWarningProps) {
  const sessionQuery = useAuthSession()
  if (!canIssueInvoice || !canManageWorkshopEstimates(sessionQuery.data?.activeRole)) {
    return null
  }
  return <OverrunWarningAlert orderId={orderId} />
}

/** Reads the estimate only once the gate is open, so a role that cannot read estimates never requests it. */
function OverrunWarningAlert({ orderId }: { orderId: string }) {
  const { t } = useTranslation('workshop')
  const { data: estimate } = useWorkshopOrderEstimate(orderId)
  const overrun = estimate?.overrun_warning
  if (!overrun?.requires_customer_notice) {
    return null
  }
  return (
    <Alert
      role="alert"
      className="border-amber-400 bg-amber-50 text-amber-900 [&>svg]:text-amber-700"
      data-testid="invoice-overrun-warning"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle as="h3">{t('invoiceOverrun.title')}</AlertTitle>
      <AlertDescription>
        {overrun.notified_at ? (
          <>
            {t('invoiceOverrun.notified', {
              notified: formatEstimateMoney(overrun.notified_amount_gross),
              current: formatEstimateMoney(overrun.current_total_gross),
            })}{' '}
          </>
        ) : (
          <>
            {t('invoiceOverrun.notNotified', {
              current: formatEstimateMoney(overrun.current_total_gross),
              approved: formatEstimateMoney(overrun.approved_total_gross),
            })}{' '}
          </>
        )}
        {t('invoiceOverrun.canStillInvoice')}
      </AlertDescription>
    </Alert>
  )
}
