import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TyreSet } from '@/api/tyre-storage'
import type { WorkshopOrder } from '@/api/types'
import { downloadCreditNotePdf, type CreditNoteResponseDto } from '@/api/useCreditNotes'
import { canPrintCreditNote, canRecordTyreMeasurement } from '@/features/actions/action-role-predicates'
import { ENTITY_ACTION_IDS, isRegisteredEntityActionId } from '@/features/actions/entity-action'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import {
  createCreditNotePrintAction,
  creditNoteToActionRecord,
  type CreditNoteActionRecord,
  type CreditNoteRowActionContext,
} from '@/features/actions/credit-note-row-actions'
import { createTyreSetTyreMeasurementAction, type TyreSetRowActionContext } from '@/features/actions/tyre-set-row-actions'
import { createWorkshopOrderTyreMeasurementAction, type WorkshopOrderListRow, type WorkshopOrderRowActionContext } from '@/features/actions/work-order-row-actions'
import { workshopOrderToListRow } from '@/features/peek/WorkshopOrderPeekContent'
import {
  clearUndoEligibleEntry,
  setUndoEligibleEntry,
} from '@/features/interaction/undo-eligible-entry-store'
import { triggerBlobDownload } from '@/lib/download'
import { i18n } from '@/lib/i18n'
import { buildPaletteContextSection } from './build-palette-context-section'

vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('@/api/useCreditNotes', async () => {
  const actual = await vi.importActual<typeof import('@/api/useCreditNotes')>('@/api/useCreditNotes')
  return { ...actual, downloadCreditNotePdf: vi.fn() }
})

const tyreSet: TyreSet = {
  id: 'set-1',
  customerId: 'customer-1',
  vehicleId: 'vehicle-1',
  siteId: 'site-1',
  label: 'Winter set',
  season: 'WINTER',
  tyreCount: 4,
  rimType: 'ALLOY',
  dotCodes: [],
  status: 'IN_STORAGE',
}

const translations = {
  nav: i18n.getFixedT('de', 'nav') as TFunction<'nav'>,
  workshop: i18n.getFixedT('de', 'workshop') as TFunction<'workshop'>,
  customers: i18n.getFixedT('de', 'customers') as TFunction<'customers'>,
  vehicles: i18n.getFixedT('de', 'vehicles') as TFunction<'vehicles'>,
  finance: i18n.getFixedT('de', 'finance') as TFunction<'finance'>,
  sales: i18n.getFixedT('de', 'sales') as TFunction<'sales'>,
}

function buildSection(role: string | undefined, record: TyreSet = tyreSet, query = '') {
  const navigate = vi.fn()
  const section = buildPaletteContextSection(
    { entity: 'tyre_set', id: record.id },
    role,
    query,
    { tyreSet: record },
    translations,
    {
      workshop: { navigate, generatePdf: {} as never, t: translations.workshop },
      customer: { navigate, onDelete: vi.fn(), t: translations.customers },
      vehicle: { navigate, t: translations.vehicles },
      estimate: { navigate },
      tyreSet: { navigate },
      creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
      salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
    },
  )
  return { section, navigate }
}

afterEach(cleanup)

describe('tyre set palette context', () => {
  it.each(['OWNER', 'ADMIN', 'SALES', 'TECH'])('offers the same registered page and palette action to %s', (role) => {
    const { section, navigate } = buildSection(role)
    expect(section?.items.map((item) => item.id)).toEqual(['tyreSet.recordTyreMeasurement'])
    const action = section!.items[0]
    expect(isRegisteredEntityActionId(action.id)).toBe(true)
    expect(action.label).toBe('Reifenmessung erfassen')
    const definition = createTyreSetTyreMeasurementAction(translations.workshop)
    expect(definition.isAllowedForRole).toBe(canRecordTyreMeasurement)
    render(createElement(RegistryActionButton<TyreSet, TyreSetRowActionContext>, {
      action: definition, record: tyreSet, runContext: { navigate }, role,
    }))
    const button = screen.getByRole('button', { name: 'Reifenmessung erfassen' })
    expect(button).toHaveAttribute('data-action-id', 'tyreSet.recordTyreMeasurement')
    fireEvent.click(button)
    action.onSelect()
    expect(navigate.mock.calls).toEqual([
      ['/workshop/tyre-storage/set-1?action=recordTyreMeasurement'],
      ['/workshop/tyre-storage/set-1?action=recordTyreMeasurement'],
    ])
  })

  it.each(['ACCOUNTANT', 'SERVICE_ADVISOR', 'MECHANIC', 'SUPER_ADMIN', 'owner', '', undefined])(
    'hides measurement from unsupported role %s',
    (role) => expect(buildSection(role).section).toBeNull(),
  )

  it.each(['NEW', 'IN_STORAGE', 'ON_VEHICLE', 'RETURNED'] as const)(
    'allows measurement for vehicle-linked %s sets',
    (status) => expect(buildSection('ADMIN', { ...tyreSet, status }).section?.items).toHaveLength(1),
  )

  it('allows condition inspection of disposed sets without a storage movement', () => {
    expect(buildSection('ADMIN', { ...tyreSet, status: 'DISPOSED' }).section?.items).toHaveLength(1)
  })

  it.each([undefined, null, ''])('hides measurement without a vehicle (%s)', (vehicleId) => {
    expect(buildSection('ADMIN', { ...tyreSet, vehicleId }).section).toBeNull()
  })

  it('filters the measurement action by label and hides unrelated queries', () => {
    expect(buildSection('ADMIN', tyreSet, 'Reifenmessung').section?.items).toHaveLength(1)
    expect(buildSection('ADMIN', tyreSet, tyreSet.label).section?.items).toHaveLength(1)
    expect(buildSection('ADMIN', tyreSet, 'unrelated query').section).toBeNull()
  })
})

describe('work order measurement page and palette parity', () => {
  const order: WorkshopOrder = {
    id: 'order-1',
    order_number: 'WO-1',
    status: 'INVOICED',
    purpose: 'CUSTOMER_REPAIR',
    vehicle_id: 'vehicle-1',
    odometer: 50000,
    fuel_level: 50,
    customer: { id: 'customer-1', type: 'PRIVATE', first_name: 'Alex', last_name: 'Example' },
    vehicle: { id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2024 },
    tasks: [],
    createdAt: '2026-01-01T12:00:00Z',
  }

  it.each(['OWNER', 'ADMIN', 'SALES', 'TECH', 'ACCOUNTANT', 'MECHANIC', undefined])(
    'uses identical role gating and deep links for an invoiced order (%s)',
    (role) => {
      const navigate = vi.fn()
      const workshop = { navigate, generatePdf: {} as never, t: translations.workshop }
      const section = buildPaletteContextSection(
        { entity: 'workshop_order', id: order.id }, role, '', { order }, translations,
        {
          workshop,
          customer: { navigate, onDelete: vi.fn(), t: translations.customers },
          vehicle: { navigate, t: translations.vehicles },
          estimate: { navigate },
          tyreSet: { navigate },
          creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
        salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
        },
      )
      const action = section?.items.find((item) => item.id === 'workOrder.recordTyreMeasurement')
      const definition = createWorkshopOrderTyreMeasurementAction(translations.workshop)
      expect(definition.isAllowedForRole).toBe(canRecordTyreMeasurement)
      render(createElement(RegistryActionButton<WorkshopOrderListRow, WorkshopOrderRowActionContext>, {
        action: definition, record: workshopOrderToListRow(order), runContext: workshop, role,
      }))
      const button = screen.queryByRole('button', { name: 'Reifenmessung erfassen' })
      if (role === 'OWNER' || role === 'ADMIN' || role === 'SALES' || role === 'TECH') {
        expect(button).toHaveAttribute('data-action-id', 'workOrder.recordTyreMeasurement')
        expect(action?.label).toBe('Reifenmessung erfassen')
        fireEvent.click(button!)
        action!.onSelect()
        expect(navigate.mock.calls).toEqual([
          ['/workshop/orders/order-1?action=recordTyreMeasurement'],
          ['/workshop/orders/order-1?action=recordTyreMeasurement'],
        ])
      } else {
        expect(button).toBeNull()
        expect(action).toBeUndefined()
      }
    },
  )
})

describe('work order notes undo palette context', () => {
  const openOrder: WorkshopOrder = {
    id: 'order-undo-1',
    order_number: 'WO-UNDO',
    status: 'INTAKE',
    purpose: 'CUSTOMER_REPAIR',
    vehicle_id: 'vehicle-1',
    odometer: 1000,
    fuel_level: 50,
    customer: { id: 'customer-1', type: 'PRIVATE', first_name: 'Alex', last_name: 'Example' },
    vehicle: { id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2024 },
    tasks: [],
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-11-05T12:00:00.000Z',
  }

  afterEach(() => {
    clearUndoEligibleEntry()
  })

  it('WHEN Cmd/Ctrl+K Undo is invoked on desktop after the pilot edit THEN the existing Undo action still runs', () => {
    setUndoEligibleEntry({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: openOrder.id,
      previousNotes: 'Old notes',
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
      contextGeneration: 0,
    })
    const undoNotes = vi.fn()
    const navigate = vi.fn()
    const workshop = {
      navigate,
      generatePdf: {} as never,
      t: translations.workshop,
      undoNotes,
    }
    const section = buildPaletteContextSection(
      { entity: 'workshop_order', id: openOrder.id },
      'ADMIN',
      '',
      { order: openOrder },
      translations,
      {
        workshop,
        customer: { navigate, onDelete: vi.fn(), t: translations.customers },
        vehicle: { navigate, t: translations.vehicles },
        estimate: { navigate },
        tyreSet: { navigate },
        creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
        salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
      },
    )
    const item = section?.items.find((entry) => entry.id === ENTITY_ACTION_IDS.workOrderUndoNotes)
    expect(item?.label).toBe(translations.workshop('orderDetail.undoNotes.action'))
    item!.onSelect()
    expect(undoNotes).toHaveBeenCalledWith(openOrder.id)
  })

  it('omits undo from Cmd+K when the order updatedAt no longer matches the eligible entry', () => {
    setUndoEligibleEntry({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: openOrder.id,
      previousNotes: 'Old notes',
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
      contextGeneration: 0,
    })
    const navigate = vi.fn()
    const workshop = {
      navigate,
      generatePdf: {} as never,
      t: translations.workshop,
      undoNotes: vi.fn(),
    }
    const staleOrder = { ...openOrder, updatedAt: '2026-11-05T13:00:00.000Z' }
    const section = buildPaletteContextSection(
      { entity: 'workshop_order', id: staleOrder.id },
      'ADMIN',
      '',
      { order: staleOrder },
      translations,
      {
        workshop,
        customer: { navigate, onDelete: vi.fn(), t: translations.customers },
        vehicle: { navigate, t: translations.vehicles },
        estimate: { navigate },
        tyreSet: { navigate },
        creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
        salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
      },
    )
    expect(
      section?.items.find((entry) => entry.id === ENTITY_ACTION_IDS.workOrderUndoNotes),
    ).toBeUndefined()
  })
})

describe('work order reschedule and task status in Cmd+K', () => {
  const order: WorkshopOrder = {
    id: 'order-1',
    order_number: 'WO-1',
    status: 'SCHEDULED',
    purpose: 'CUSTOMER_REPAIR',
    vehicle_id: 'vehicle-1',
    odometer: 1000,
    fuel_level: 50,
    bayId: 'bay-1',
    scheduledStartAt: '2026-08-21T06:00:00.000Z',
    scheduledEndAt: '2026-08-21T07:30:00.000Z',
    customer: { id: 'customer-1', type: 'PRIVATE', first_name: 'Alex', last_name: 'Example' },
    vehicle: { id: 'vehicle-1', make: 'Audi', model: 'A4', year: 2024 },
    tasks: [
      {
        id: 'task-1',
        title: 'Oil Change',
        lineItemsVersion: 0,
        status: 'IN_PROGRESS',
        done: false,
        lineItems: [],
      },
    ],
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-08-21T06:00:00.000Z',
  }

  function sectionFor(role: string) {
    const updateTaskStatus = vi.fn()
    const reschedule = vi.fn()
    const navigate = vi.fn()
    const workshop = {
      navigate,
      generatePdf: {} as never,
      t: translations.workshop,
      updateTaskStatus,
      reschedule,
    }
    const section = buildPaletteContextSection(
      { entity: 'workshop_order', id: order.id },
      role,
      '',
      { order },
      translations,
      {
        workshop,
        customer: { navigate, onDelete: vi.fn(), t: translations.customers },
        vehicle: { navigate, t: translations.vehicles },
        estimate: { navigate },
        tyreSet: { navigate },
        creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
        salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
      },
    )
    return { section, updateTaskStatus, reschedule }
  }

  it('runs a task status and a reschedule from the palette with the registry actions', () => {
    const { section, updateTaskStatus, reschedule } = sectionFor('ADMIN')
    const taskStatus = section?.items.find((item) => item.id === ENTITY_ACTION_IDS.workOrderTaskState)
    const waiting = taskStatus?.children
      ?.find((task) => task.label === 'Oil Change')
      ?.children?.find((choice) => choice.id.endsWith('WAITING_PARTS'))
    expect(taskStatus?.children?.[0]?.children?.some((choice) => choice.id.endsWith('IN_PROGRESS'))).toBe(
      false,
    )
    waiting?.onSelect()
    expect(updateTaskStatus).toHaveBeenCalledWith('order-1', 'task-1', 'WAITING_PARTS')

    const move = section?.items.find((item) => item.id === ENTITY_ACTION_IDS.workOrderReschedule)
    expect(move?.children?.length).toBeGreaterThan(0)
    expect(move?.children?.some((choice) => choice.id.endsWith('20260821'))).toBe(false)
    move?.children?.[0]?.onSelect()
    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        bayId: 'bay-1',
        startIso: '2026-08-21T06:00:00.000Z',
        endIso: '2026-08-21T07:30:00.000Z',
      }),
    )
  })

  it('keeps reschedule for a technician and withholds task status', () => {
    const { section } = sectionFor('TECH')
    expect(section?.items.map((item) => item.id)).toContain(ENTITY_ACTION_IDS.workOrderReschedule)
    expect(section?.items.map((item) => item.id)).not.toContain(ENTITY_ACTION_IDS.workOrderTaskState)
  })

  it('withholds reschedule when the order is not eligible', () => {
    const { section } = sectionFor('ADMIN')
    const inProgress = buildPaletteContextSection(
      { entity: 'workshop_order', id: order.id },
      'ADMIN',
      '',
      { order: { ...order, status: 'IN_PROGRESS' } },
      translations,
      {
        workshop: {
          navigate: vi.fn(),
          generatePdf: {} as never,
          t: translations.workshop,
          updateTaskStatus: vi.fn(),
          reschedule: vi.fn(),
        },
        customer: { navigate: vi.fn(), onDelete: vi.fn(), t: translations.customers },
        vehicle: { navigate: vi.fn(), t: translations.vehicles },
        estimate: { navigate: vi.fn() },
        tyreSet: { navigate: vi.fn() },
        creditNote: { t: translations.finance, generateAndDownload: vi.fn() },
        salesOrder: { navigate: vi.fn(), onDelete: vi.fn(), t: translations.sales },
      },
    )
    expect(section?.items.map((item) => item.id)).toContain(ENTITY_ACTION_IDS.workOrderReschedule)
    expect(inProgress?.items.map((item) => item.id)).not.toContain(ENTITY_ACTION_IDS.workOrderReschedule)
  })
})

describe('credit note print page and palette parity', () => {
  function makeCreditNote(overrides: Partial<CreditNoteResponseDto> = {}): CreditNoteResponseDto {
    return {
      id: 'cn-1',
      originalInvoiceId: 'inv-1',
      status: 'FINALIZED',
      creditNumber: 'CN-2026-0001',
      date: '2026-03-01',
      reason: 'Pricing correction',
      version: 1,
      totalNet: '50.00',
      totalTax: '9.50',
      totalGross: '59.50',
      items: [],
      remainingLines: [],
      pdfGeneratedAt: '2026-03-02T00:00:00.000Z',
      ...overrides,
    }
  }

  function buildCreditNoteSection(role: string | undefined, note: CreditNoteResponseDto) {
    const navigate = vi.fn()
    const generateAndDownload = vi.fn().mockResolvedValue(true)
    const section = buildPaletteContextSection(
      { entity: 'credit_note', id: note.id },
      role,
      '',
      { creditNote: note },
      translations,
      {
        workshop: { navigate, generatePdf: {} as never, t: translations.workshop },
        customer: { navigate, onDelete: vi.fn(), t: translations.customers },
        vehicle: { navigate, t: translations.vehicles },
        estimate: { navigate },
        tyreSet: { navigate },
        creditNote: { t: translations.finance, generateAndDownload },
        salesOrder: { navigate, onDelete: vi.fn(), t: translations.sales },
      },
    )
    return { section, generateAndDownload }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['OWNER', '2026-03-02T00:00:00.000Z', true],
    ['OWNER', null, true],
    ['ADMIN', null, true],
    ['SALES', '2026-03-02T00:00:00.000Z', true],
    ['SALES', null, false],
    ['TECH', '2026-03-02T00:00:00.000Z', false],
  ])('offers the same registered print action to %s (pdfGeneratedAt=%s)', (role, pdfGeneratedAt, visible) => {
    const { section } = buildCreditNoteSection(role, makeCreditNote({ pdfGeneratedAt }))
    const definition = createCreditNotePrintAction(translations.finance)
    expect(definition.isAllowedForRole).toBe(canPrintCreditNote)
    if (!visible) {
      expect(section).toBeNull()
      return
    }
    const action = section!.items[0]
    expect(action.id).toBe('creditNote.print')
    expect(isRegisteredEntityActionId(action.id)).toBe(true)
    expect(action.label).toBe('Drucken')
    render(createElement(RegistryActionButton<CreditNoteActionRecord, CreditNoteRowActionContext>, {
      action: definition,
      record: creditNoteToActionRecord(makeCreditNote({ pdfGeneratedAt }), role),
      runContext: { t: translations.finance, generateAndDownload: vi.fn() },
      role,
    }))
    expect(screen.getByRole('button', { name: 'Drucken' })).toHaveAttribute(
      'data-action-id',
      'creditNote.print',
    )
  })

  it('generates over POST then downloads for OWNER when no PDF exists yet', async () => {
    const { section, generateAndDownload } = buildCreditNoteSection('OWNER', makeCreditNote({ pdfGeneratedAt: null }))
    section!.items[0].onSelect()
    await waitFor(() =>
      expect(generateAndDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          postUrl: '/api/credit-notes/cn-1/pdf',
          getUrl: '/api/credit-notes/cn-1/pdf',
        }),
      ),
    )
    expect(downloadCreditNotePdf).not.toHaveBeenCalled()
  })

  it('downloads an existing PDF over GET only for SALES and never POSTs', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    vi.mocked(downloadCreditNotePdf).mockResolvedValue(blob)
    const { section, generateAndDownload } = buildCreditNoteSection(
      'SALES',
      makeCreditNote({ pdfGeneratedAt: '2026-03-02T00:00:00.000Z' }),
    )
    section!.items[0].onSelect()
    await waitFor(() => expect(downloadCreditNotePdf).toHaveBeenCalledWith('cn-1', { poll: false }))
    expect(triggerBlobDownload).toHaveBeenCalledWith(blob, 'credit_note_cn_2026_0001.pdf')
    expect(generateAndDownload).not.toHaveBeenCalled()
  })
})
