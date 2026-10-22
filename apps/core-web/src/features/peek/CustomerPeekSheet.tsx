import type { PeekListControl } from './peek-list-control'
import { CustomerPeekContent } from './CustomerPeekContent'
import { EntityPeekActionButtons } from './EntityPeekActionButtons'
import { EntityPeekSheet } from './EntityPeekSheet'
import { useCustomerPeekSheetData } from './use-customer-peek-sheet-data'

type CustomerPeekSheetProps = Pick<PeekListControl, 'peekId' | 'isPeekOpen' | 'closePeek'>

export function CustomerPeekSheet({ peekId, isPeekOpen, closePeek }: CustomerPeekSheetProps) {
  const { t, customer, isLoading, role, definitions, runContext, openInFullHref, title } =
    useCustomerPeekSheetData(peekId, closePeek)

  return (
    <EntityPeekSheet
      open={isPeekOpen}
      onOpenChange={(open) => {
        if (!open) closePeek()
      }}
      title={title}
      description={customer?.email ?? undefined}
      openInFullHref={openInFullHref}
      isLoading={Boolean(peekId) && isLoading}
      isNotFound={Boolean(peekId) && !isLoading && !customer}
      notFoundTitle={t('peek.notFound')}
      actions={
        customer ? (
          <EntityPeekActionButtons
            definitions={definitions}
            role={role}
            record={customer}
            runContext={runContext}
          />
        ) : null
      }
    >
      {customer ? <CustomerPeekContent customer={customer} t={t} /> : null}
    </EntityPeekSheet>
  )
}
