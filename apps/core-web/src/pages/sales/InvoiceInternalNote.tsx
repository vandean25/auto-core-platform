import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { invoiceDetailQueryOptions, useUpdateInvoice, type CreateInvoicePayload } from '@/api/sales'
import type { Invoice } from '@/api/types'
import { InteractionErrorMarker } from '@/components/data-table/data-table-states'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Label } from '@/components/ui/label'
import { FieldSaveFailures, useOptimisticFieldSave } from '@/features/interaction/use-optimistic-field-save'
import { isInvoiceUpdateOptimisticEligible } from '@/features/interaction/invoice-update-eligibility'
import { getErrorStatus } from '@/lib/error-utils'

type Props = {
  invoiceId: string
  note: string
  buildPayload: () => CreateInvoicePayload | null
}

/** Internal note of a draft. Eligible on its own; a 409 shows the server note and does not replay the write. */
export function InvoiceInternalNote({ invoiceId, note, buildPayload }: Props) {
  const { t } = useTranslation('sales')
  const queryClient = useQueryClient()
  const updateInvoice = useUpdateInvoice()
  const [conflictNote, setConflictNote] = useState<string | null>(null)

  const fieldSave = useOptimisticFieldSave<string, string>({
    save: async (_field, value) => {
      const payload = buildPayload()
      if (!payload) throw new Error('incomplete invoice draft')
      const variables = {
        id: invoiceId,
        payload: { ...payload, internalNotes: value },
        changedFields: ['internalNotes'] as const,
      }
      try {
        return await updateInvoice.mutateAsync(variables)
      } catch (error) {
        if (getErrorStatus(error) !== 409) throw error
        const current = await queryClient.fetchQuery({ ...invoiceDetailQueryOptions(invoiceId), staleTime: 0 })
        setConflictNote(current.internal_notes ?? '')
        return 'conflict'
      }
    },
    isOptimistic: () => isInvoiceUpdateOptimisticEligible({ changedFields: ['internalNotes'] }),
    successMessage: t('invoices.draft.internalNotesSaved'),
    onSaved: (result) => {
      if (result === 'conflict') return
      setConflictNote(null)
      toast.success(t('invoices.draft.internalNotesSaved'))
    },
    failureMessage: t('invoices.draft.internalNotesFailed'),
  })

  return (
    <div className="mt-8 space-y-2 border-t pt-6">
      <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
        {t('invoices.draft.internalNotes')}
      </Label>
      <InlineEdit
        value={note}
        onSave={(value) => fieldSave.saveField('internalNotes', value)}
        emptyText={t('invoices.draft.internalNotesEmpty')}
        ariaLabel={t('invoices.draft.internalNotesAria')}
      />
      {conflictNote !== null ? (
        <InteractionErrorMarker
          message={t('invoices.draft.noteConflict', { note: conflictNote || t('shared.emDash') })}
          onDismiss={() => setConflictNote(null)}
        />
      ) : null}
      <FieldSaveFailures
        failures={fieldSave.failures}
        message={() => t('invoices.draft.internalNotesFailed')}
        onRetry={fieldSave.retry}
        onDismiss={fieldSave.dismiss}
      />
    </div>
  )
}

export function invoiceInternalNote(invoice: Invoice | undefined): string {
  return invoice?.internal_notes ?? ''
}
