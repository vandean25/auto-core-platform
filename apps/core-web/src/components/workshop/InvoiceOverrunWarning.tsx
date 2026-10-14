import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useWorkshopOrderEstimate } from '@/api/workshop-estimates'
import { formatEstimateMoney } from '@/features/workshop/workshop-estimate-decision'

/**
 * Warning at invoice finalisation (AUT-355, ADR-0025 §1): the order is above the approved estimate and the customer has
 * not been told about it. It is a warning only, so the invoice can still be issued.
 */
export function InvoiceOverrunWarning({ orderId }: { orderId: string }) {
  const { data: estimate } = useWorkshopOrderEstimate(orderId)
  const overrun = estimate?.overrun_warning
  if (!overrun || !overrun.requires_customer_notice) {
    return null
  }
  return (
    <Alert
      role="alert"
      className="border-amber-400 bg-amber-50 text-amber-900 [&>svg]:text-amber-700"
      data-testid="invoice-overrun-warning"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle as="h3">Rechnung weicht vom freigegebenen Kostenvoranschlag ab</AlertTitle>
      <AlertDescription>
        Der Auftragsbetrag liegt bei {formatEstimateMoney(overrun.current_total_gross)} brutto, freigegeben waren{' '}
        {formatEstimateMoney(overrun.approved_total_gross)}. Der Kunde wurde noch nicht über die Abweichung informiert.
        Die Rechnung kann trotzdem ausgestellt werden.
      </AlertDescription>
    </Alert>
  )
}
