import { CustomerPeekContent } from './CustomerPeekContent'
import { EntityPeekActionButtons } from './EntityPeekActionButtons'
import { EntityPeekSheet } from './EntityPeekSheet'
import { useCustomerPeekSheetData } from './use-customer-peek-sheet-data'

export function CustomerPeekSheet() {
  const {
    t,
    peekId,
    isPeekOpen,
    closePeek,
    customer,
    isLoading,
    role,
    definitions,
    runContext,
    openInFullHref,
    title,
  } = useCustomerPeekSheetData()

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
