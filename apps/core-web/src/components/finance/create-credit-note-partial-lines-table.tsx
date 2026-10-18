import { useTranslation } from 'react-i18next'

import { CreditNoteLineQuantityInput } from '@/components/finance/credit-note-line-quantity-input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CreditQuantityValidation } from '@/lib/credit-note-quantity'

export type CreateCreditNotePartialLine = {
  originalItemId: string
  description: string
  remainingQuantity: string
  quantity: string
}

type CreateCreditNotePartialLinesTableProps = {
  isCreditContextLoading: boolean
  partialLines: CreateCreditNotePartialLine[]
  partialLineErrors: Map<string, CreditQuantityValidation>
  onPartialLinesChange: (
    updater: (current: CreateCreditNotePartialLine[]) => CreateCreditNotePartialLine[],
  ) => void
}

export function CreateCreditNotePartialLinesTable({
  isCreditContextLoading,
  partialLines,
  partialLineErrors,
  onPartialLinesChange,
}: CreateCreditNotePartialLinesTableProps) {
  const { t } = useTranslation('finance')

  return (
    <div className="space-y-2">
      <Label>{t('creditNotes.createDialog.creditedQuantities')}</Label>
      {isCreditContextLoading ? (
        <p className="text-sm text-muted-foreground">{t('creditNotes.createDialog.loadingRemaining')}</p>
      ) : partialLines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('creditNotes.createDialog.noPartialLines')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.description')}</TableHead>
              <TableHead className="text-right">{t('columns.remaining')}</TableHead>
              <TableHead className="text-right">{t('columns.creditQty')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partialLines.map((line) => {
              const lineError = partialLineErrors.get(line.originalItemId)
              return (
                <TableRow key={line.originalItemId}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {line.remainingQuantity}
                  </TableCell>
                  <TableCell className="text-right">
                    <CreditNoteLineQuantityInput
                      className="ml-auto max-w-[120px] text-right"
                      description={line.description}
                      value={line.quantity}
                      id={`credit-line-quantity-${line.originalItemId}`}
                      aria-invalid={Boolean(lineError)}
                      aria-describedby={
                        lineError ? `credit-line-quantity-${line.originalItemId}-error` : undefined
                      }
                      onChange={(event) => {
                        const nextQuantity = event.target.value
                        onPartialLinesChange((current) =>
                          current.map((entry) =>
                            entry.originalItemId === line.originalItemId
                              ? { ...entry, quantity: nextQuantity }
                              : entry,
                          ),
                        )
                      }}
                    />
                    {lineError ? (
                      <p
                        id={`credit-line-quantity-${line.originalItemId}-error`}
                        role="alert"
                        className="mt-1 text-xs text-destructive"
                      >
                        {'params' in lineError ? t(lineError.key, lineError.params) : t(lineError.key)}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
