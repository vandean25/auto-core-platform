import { EntityPeekActionButtons } from './EntityPeekActionButtons'
import { EntityPeekSheet } from './EntityPeekSheet'
import { VehiclePeekContent } from './VehiclePeekContent'
import { useVehiclePeekSheetData } from './use-vehicle-peek-sheet-data'

export function VehiclePeekSheet() {
  const {
    t,
    peekId,
    isPeekOpen,
    closePeek,
    vehicle,
    isLoading,
    role,
    listRow,
    actionDefinitions,
    runContext,
    openInFullHref,
    title,
  } = useVehiclePeekSheetData()

  return (
    <EntityPeekSheet
      open={isPeekOpen}
      onOpenChange={(open) => {
        if (!open) closePeek()
      }}
      title={title}
      description={vehicle?.plate ?? undefined}
      openInFullHref={openInFullHref}
      isLoading={Boolean(peekId) && isLoading}
      isNotFound={Boolean(peekId) && !isLoading && !vehicle}
      notFoundTitle={t('peek.notFound')}
      actions={
        listRow ? (
          <EntityPeekActionButtons
            definitions={actionDefinitions}
            role={role}
            record={listRow}
            runContext={runContext}
          />
        ) : null
      }
    >
      {vehicle ? <VehiclePeekContent vehicle={vehicle} t={t} /> : null}
    </EntityPeekSheet>
  )
}
