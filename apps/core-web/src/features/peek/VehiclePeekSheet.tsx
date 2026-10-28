import type { PeekListControl } from './peek-list-control'
import { EntityPeekSheet } from './EntityPeekSheet'
import { buildPeekMenuActions } from './peek-menu-actions'
import { VehiclePeekContent } from './VehiclePeekContent'
import { useVehiclePeekSheetData } from './use-vehicle-peek-sheet-data'

type VehiclePeekSheetProps = Pick<PeekListControl, 'peekId' | 'isPeekOpen' | 'closePeek'>

export function VehiclePeekSheet({ peekId, isPeekOpen, closePeek }: VehiclePeekSheetProps) {
  const {
    t,
    vehicle,
    isLoading,
    role,
    listRow,
    actionDefinitions,
    runContext,
    openInFullHref,
    title,
  } = useVehiclePeekSheetData(peekId)

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
      moreActions={listRow ? buildPeekMenuActions(actionDefinitions, role, listRow, runContext) : []}
    >
      {vehicle ? <VehiclePeekContent vehicle={vehicle} t={t} /> : null}
    </EntityPeekSheet>
  )
}
