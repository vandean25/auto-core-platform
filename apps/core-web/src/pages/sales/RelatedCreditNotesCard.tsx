import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { InvoiceCreditContextResponseDto } from '@/api/useCreditNotes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/status/StatusBadge'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatCurrency } from '@/lib/utils'

export function RelatedCreditNotesCard({ creditContext }: { creditContext?: InvoiceCreditContextResponseDto }) {
  const { t } = useTranslation('sales')

  if (!creditContext || creditContext.creditNotes.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('invoices.detail.relatedCreditNotes')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {creditContext.creditNotes.map((creditNote) => (
          <div
            key={creditNote.id}
            className="flex items-center justify-between rounded-md border px-4 py-3"
          >
            <div className="space-y-1">
              <Link
                to={APP_ROUTE_PATHS.creditNoteDetail.replace(':id', creditNote.id)}
                className="font-medium text-primary hover:underline"
              >
                {creditNote.creditNumber ??
                  t('shared.creditDraftLabel', { id: creditNote.id.slice(0, 8) })}
              </Link>
              <div className="text-sm text-muted-foreground">{creditNote.reason}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium">
                {formatCurrency(Number(creditNote.totalGross))}
              </div>
              <StatusBadge status={creditNote.status} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
