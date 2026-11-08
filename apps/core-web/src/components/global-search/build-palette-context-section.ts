import type { TyreSet } from '@/api/tyre-storage'
import type { CreditNoteResponseDto } from '@/api/useCreditNotes'
import type { Customer } from '@/api/types'
import type { Vehicle } from '@/api/types'
import type { WorkshopEstimateVersionDetail } from '@/api/workshop-estimates'
import type { EstimateRowActionContext } from '@/features/actions/estimate-row-actions'
import { createEstimateRowActions } from '@/features/actions/estimate-row-actions'
import type { WorkshopOrder } from '@/api/types'
import type { CustomerRowActionContext } from '@/features/actions/customer-row-actions'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import type { VehicleRowActionContext } from '@/features/actions/vehicle-row-actions'
import { createVehicleRowActions } from '@/features/actions/vehicle-row-actions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import type { WorkshopOrderRowActionContext } from '@/features/actions/work-order-row-actions'
import { createWorkshopOrderRowActions, createWorkshopOrderTyreMeasurementAction } from '@/features/actions/work-order-row-actions'
import { createWorkshopOrderUndoNotesAction } from '@/features/actions/work-order-undo-notes-action'
import { workshopOrderToListRow } from '@/features/peek/WorkshopOrderPeekContent'
import { createTyreSetTyreMeasurementAction, type TyreSetRowActionContext } from '@/features/actions/tyre-set-row-actions'
import { createCreditNotePrintAction, type CreditNoteRowActionContext } from '@/features/actions/credit-note-row-actions'
import {
  buildCreditNotePaletteContextActions,
  buildCustomerPaletteContextActions,
  buildEstimatePaletteContextActions,
  buildVehiclePaletteContextActions,
  buildWorkshopOrderPaletteContextActions,
  filterPaletteContextActions,
  mapRegistryActionsToPalette,
  type PaletteContextAction,
  type PaletteContextActionSection,
} from './global-search-context-actions'
import type { GlobalSearchRecordRef } from './global-search-record-route'
import type { PaletteContextTranslations } from './use-palette-context-translations'

type PaletteContextRunContexts = {
  workshop: WorkshopOrderRowActionContext
  customer: CustomerRowActionContext
  vehicle: VehicleRowActionContext
  estimate: EstimateRowActionContext
  tyreSet: TyreSetRowActionContext
  creditNote: CreditNoteRowActionContext
}

type PaletteRecords = {
  order?: WorkshopOrder
  customer?: Customer
  vehicle?: Vehicle
  estimate?: WorkshopEstimateVersionDetail
  tyreSet?: TyreSet
  creditNote?: CreditNoteResponseDto
}

type PaletteSectionInput = {
  ref: GlobalSearchRecordRef
  role: string | undefined
  records: PaletteRecords
  translations: PaletteContextTranslations
  runContexts: PaletteContextRunContexts
}

function technicianOrderRecord(input: PaletteSectionInput) {
  const order = input.records.order
  if (order) return workshopOrderToListRow(order)
  return {
    id: input.ref.id,
    orderNo: input.ref.id,
    customer: '',
    vehicle: '',
    openedAt: '',
    status: 'INVOICED' as const,
  }
}

function technicianOrderItems(input: PaletteSectionInput): PaletteContextAction[] {
  const workshop = input.translations.workshop
  const orderActions = createWorkshopOrderRowActions(workshop)
  return mapRegistryActionsToPalette(
    [
      createWorkshopOrderTyreMeasurementAction(workshop),
      ...orderActions.filter((action) => action.id === ENTITY_ACTION_IDS.workOrderReschedule),
    ],
    input.role,
    technicianOrderRecord(input),
    input.runContexts.workshop,
    () => '',
  )
}

function workshopOrderItems(input: PaletteSectionInput): PaletteContextAction[] {
  const order = input.records.order
  if (!order) return []
  const workshop = input.translations.workshop
  const rowActions = buildWorkshopOrderPaletteContextActions(
    createWorkshopOrderRowActions(workshop),
    input.role,
    order,
    input.runContexts.workshop,
    input.translations.nav,
  )
  const undoItems = mapRegistryActionsToPalette(
    [createWorkshopOrderUndoNotesAction(workshop)],
    input.role,
    order,
    input.runContexts.workshop,
    () => order.order_number ?? order.id,
  )
  return [...rowActions, ...undoItems]
}

function customerItems(input: PaletteSectionInput): PaletteContextAction[] {
  const customer = input.records.customer
  if (!customer) return []
  return buildCustomerPaletteContextActions(
    createCustomerRowActions(input.translations.customers),
    input.role,
    customer,
    input.runContexts.customer,
    input.translations.nav,
  )
}

function vehicleItems(input: PaletteSectionInput): PaletteContextAction[] {
  const vehicle = input.records.vehicle
  if (!vehicle) return []
  return buildVehiclePaletteContextActions(
    createVehicleRowActions(input.translations.vehicles),
    input.role,
    vehicle,
    input.runContexts.vehicle,
    input.translations.nav,
  )
}

function estimateItems(input: PaletteSectionInput): PaletteContextAction[] {
  const estimate = input.records.estimate
  if (!estimate) return []
  return buildEstimatePaletteContextActions(
    createEstimateRowActions(input.translations.workshop),
    input.role,
    estimate,
    input.runContexts.estimate,
    input.translations.nav,
  )
}

function tyreSetItems(input: PaletteSectionInput): PaletteContextAction[] {
  const tyreSet = input.records.tyreSet
  if (!tyreSet) return []
  return mapRegistryActionsToPalette(
    [createTyreSetTyreMeasurementAction(input.translations.workshop)],
    input.role,
    tyreSet,
    input.runContexts.tyreSet,
    () => tyreSet.label,
  )
}

function creditNoteItems(input: PaletteSectionInput): PaletteContextAction[] {
  const creditNote = input.records.creditNote
  if (!creditNote) return []
  return buildCreditNotePaletteContextActions(
    [createCreditNotePrintAction(input.translations.finance)],
    input.role,
    creditNote,
    input.runContexts.creditNote,
    input.translations.nav,
  )
}

const PALETTE_ITEMS: Record<
  GlobalSearchRecordRef['entity'],
  (input: PaletteSectionInput) => PaletteContextAction[]
> = {
  workshop_order: workshopOrderItems,
  customer: customerItems,
  vehicle: vehicleItems,
  estimate: estimateItems,
  tyre_set: tyreSetItems,
  credit_note: creditNoteItems,
}

function paletteItems(input: PaletteSectionInput): PaletteContextAction[] {
  if (input.ref.entity === 'workshop_order' && input.role === 'TECH') {
    return technicianOrderItems(input)
  }
  return PALETTE_ITEMS[input.ref.entity](input)
}

export function buildPaletteContextSection(
  ref: GlobalSearchRecordRef,
  role: string | undefined,
  query: string,
  records: PaletteRecords,
  translations: PaletteContextTranslations,
  runContexts: PaletteContextRunContexts,
): PaletteContextActionSection | null {
  const filtered = filterPaletteContextActions(
    paletteItems({ ref, role, records, translations, runContexts }),
    query,
  )
  if (filtered.length === 0) return null
  return { heading: translations.nav('globalSearch.contextActions.heading'), items: filtered }
}
