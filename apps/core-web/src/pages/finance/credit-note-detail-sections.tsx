import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { CreditNoteResponseDto } from '@/api/useCreditNotes'
import type { Invoice } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditNoteLineQuantityInput } from '@/components/finance/credit-note-line-quantity-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatDateShort } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import type { CreditNoteDraft } from './useCreditNoteDraft'

/** Heading text: the credit number, or a short id while the draft has none, plus the status badge. */
export function CreditNoteTitle({ creditNote }: { creditNote: CreditNoteResponseDto }) {
  const { t } = useTranslation('finance')

  return (
    <span className="flex items-center gap-3">
      {creditNote.creditNumber ?? t('shared.creditNoteTitle', { id: creditNote.id.slice(0, 8) })}
      <StatusBadge status={creditNote.status} />
    </span>
  )
}

export function CreditNoteInfoCard({
  creditNote,
  originalInvoice,
  draft,
  canEditDraft,
  canManage,
}: {
  creditNote: CreditNoteResponseDto
  originalInvoice: Invoice | undefined
  draft: CreditNoteDraft
  canEditDraft: boolean
  canManage: boolean
}) {
  const { t } = useTranslation('finance')
  const isDraft = creditNote.status === 'DRAFT'
  const originalInvoiceLabel = originalInvoice?.invoice_number ?? creditNote.originalInvoiceId.slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('creditNotes.detail.creditInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="text-muted-foreground">{t('creditNotes.detail.originalInvoice')}</div>
          <Link
            to={APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', creditNote.originalInvoiceId)}
            className="font-medium text-primary hover:underline"
          >
            {originalInvoiceLabel}
          </Link>
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-note-date">{t('columns.date')}</Label>
          {canEditDraft ? (
            <Input
              id="credit-note-date"
              type="date"
              value={draft.date}
              onChange={(event) => {
                draft.setDate(event.target.value)
                draft.queueAutoSave({ date: event.target.value })
              }}
            />
          ) : (
            <div className="font-medium">{formatDateShort(creditNote.date)}</div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="credit-note-reason">{t('columns.reason')}</Label>
          {canEditDraft ? (
            <Input
              id="credit-note-reason"
              value={draft.reason}
              onChange={(event) => {
                draft.setReason(event.target.value)
                draft.queueAutoSave({ reason: event.target.value })
              }}
            />
          ) : (
            <div className="font-medium">{creditNote.reason}</div>
          )}
        </div>
        {isDraft && !canManage ? (
          <p className="text-xs text-muted-foreground">{t('creditNotes.detail.draftEditHint')}</p>
        ) : null}
        {creditNote.status === 'FINALIZED' ? (
          <p className="text-xs text-muted-foreground">{t('creditNotes.detail.finalizedHint')}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function CreditNoteTotalsCard({ creditNote }: { creditNote: CreditNoteResponseDto }) {
  const { t } = useTranslation('finance')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('creditNotes.detail.totals')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('creditNotes.detail.net')}</span>
          <span>{formatCurrency(Number(creditNote.totalNet))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('creditNotes.detail.tax')}</span>
          <span>{formatCurrency(Number(creditNote.totalTax))}</span>
        </div>
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>{t('creditNotes.detail.gross')}</span>
          <span>{formatCurrency(Number(creditNote.totalGross))}</span>
        </div>
      </CardContent>
    </Card>
  )
}

type CreditedItem = CreditNoteResponseDto['items'][number]

function CreditedQuantityInput({
  item,
  description,
  draft,
}: {
  item: CreditedItem
  description: string
  draft: CreditNoteDraft
}) {
  const { t } = useTranslation('finance')
  const itemId = item.originalInvoiceItemId
  const lineError = draft.lineValidationErrors.get(itemId)
  const errorId = `credit-line-quantity-${itemId}-error`
  const value = draft.lines.find((line) => line.originalItemId === itemId)?.quantity ?? item.quantity

  return (
    <div className="ml-auto max-w-[160px]">
      <CreditNoteLineQuantityInput
        className="text-right"
        description={description}
        id={`credit-line-quantity-${itemId}`}
        aria-invalid={Boolean(lineError)}
        aria-describedby={lineError ? errorId : undefined}
        value={value}
        onChange={(event) => {
          const nextLines = draft.lines.map((line) =>
            line.originalItemId === itemId ? { ...line, quantity: event.target.value } : line,
          )
          draft.setLines(nextLines)
          draft.queueAutoSave({ lines: nextLines })
        }}
      />
      {lineError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {'params' in lineError ? t(lineError.key, lineError.params) : t(lineError.key)}
        </p>
      ) : null}
    </div>
  )
}

export function CreditedLinesCard({
  creditNote,
  originalInvoice,
  draft,
  canEditDraft,
}: {
  creditNote: CreditNoteResponseDto
  originalInvoice: Invoice | undefined
  draft: CreditNoteDraft
  canEditDraft: boolean
}) {
  const { t } = useTranslation('finance')
  const describeLine = (originalItemId: string) =>
    originalInvoice?.items.find((item) => item.id === originalItemId)?.description ?? originalItemId.slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('creditNotes.detail.creditedLines')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.description')}</TableHead>
              <TableHead className="text-right">{t('columns.qty')}</TableHead>
              <TableHead className="text-right">{t('columns.remaining')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditNote.items.map((item) => {
              const description = describeLine(item.originalInvoiceItemId)
              const remaining = draft.remainingByItemId.get(item.originalInvoiceItemId)
              return (
                <TableRow key={item.id}>
                  <TableCell>{description}</TableCell>
                  <TableCell className="text-right">
                    {canEditDraft ? (
                      <CreditedQuantityInput item={item} description={description} draft={draft} />
                    ) : (
                      item.quantity
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {remaining?.remainingQuantity ?? t('placeholders.missing', { ns: 'common' })}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const { t } = useTranslation('finance')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function CreditNoteDialogs({
  finalizeOpen,
  setFinalizeOpen,
  voidOpen,
  setVoidOpen,
  onFinalize,
  onVoid,
}: {
  finalizeOpen: boolean
  setFinalizeOpen: (open: boolean) => void
  voidOpen: boolean
  setVoidOpen: (open: boolean) => void
  onFinalize: () => void
  onVoid: () => void
}) {
  const { t } = useTranslation('finance')

  return (
    <>
      <ConfirmDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        title={t('creditNotes.detail.finalizeDialog.title')}
        description={t('creditNotes.detail.finalizeDialog.description')}
        confirmLabel={t('creditNotes.detail.finalizeDialog.confirm')}
        onConfirm={onFinalize}
      />
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={t('creditNotes.detail.voidDialog.title')}
        description={t('creditNotes.detail.voidDialog.description')}
        confirmLabel={t('creditNotes.detail.voidDialog.confirm')}
        onConfirm={onVoid}
      />
    </>
  )
}
