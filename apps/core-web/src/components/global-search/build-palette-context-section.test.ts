import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TyreSet } from '@/api/tyre-storage'
import type { WorkshopOrder } from '@/api/types'
import { canRecordTyreMeasurement } from '@/features/actions/action-role-predicates'
import { isRegisteredEntityActionId } from '@/features/actions/entity-action'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { createTyreSetTyreMeasurementAction, type TyreSetRowActionContext } from '@/features/actions/tyre-set-row-actions'
import { createWorkshopOrderTyreMeasurementAction, type WorkshopOrderListRow, type WorkshopOrderRowActionContext } from '@/features/actions/work-order-row-actions'
import { workshopOrderToListRow } from '@/features/peek/WorkshopOrderPeekContent'
import { i18n } from '@/lib/i18n'
import { buildPaletteContextSection } from './build-palette-context-section'

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
