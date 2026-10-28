import { describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'

import { createCustomerRowActions, type CustomerListRow } from '@/features/actions/customer-row-actions'
import {
  ENTITY_ACTION_IDS,
  filterEntityActions,
  resolveEntityActionChildren,
  type EntityActionChild,
} from '@/features/actions/entity-action'
import { createVehicleRowActions } from '@/features/actions/vehicle-row-actions'
import {
  createWorkshopOrderRowActions,
  type WorkshopOrderListRow,
  type WorkshopOrderRowActionContext,
} from '@/features/actions/work-order-row-actions'
import { buildPeekMenuActions } from './peek-menu-actions'

const t = ((key: string) => key) as unknown as TFunction<'workshop'>

function collectIds(actions: { id: string; children?: { id: string }[] }[]): string[] {
  return actions.flatMap((action) => [
    action.id,
    ...collectIds((action.children ?? []) as Parameters<typeof collectIds>[0]),
  ])
}

function collectChildIds<TRecord, TContext>(
  children: EntityActionChild<TRecord, TContext>[] | undefined,
  record: TRecord,
  context: TContext,
): string[] {
  return (children ?? [])
    .filter((child) => child.isEnabled?.(record) ?? true)
    .flatMap((child) => [
    child.id,
    ...collectChildIds(resolveEntityActionChildren(child.children, record, context), record, context),
  ])
}

describe('buildPeekMenuActions (AUT-783)', () => {
  it('leaves out the registry open action but keeps every other customer action, destructive included', () => {
    const customerT = ((key: string) => key) as unknown as TFunction<'customers'>
    const definitions = createCustomerRowActions(customerT)
    const customer = { id: 'cust-1', first_name: 'Ada', last_name: 'L' } as CustomerListRow
    const context = { navigate: vi.fn(), onDelete: vi.fn(), t: customerT }

    const actions = buildPeekMenuActions(definitions, 'ADMIN', customer, context)

    expect(actions.map((action) => action.id)).toEqual([ENTITY_ACTION_IDS.customerDelete])
    expect(actions[0].destructive).toBe(true)
  })

  it('has nothing for a vehicle, whose only registry action is open', () => {
    const vehicleT = ((key: string) => key) as unknown as TFunction<'vehicles'>
    const definitions = createVehicleRowActions(vehicleT)

    expect(
      buildPeekMenuActions(definitions, 'ADMIN', { id: 'veh-1', vehicle: 'Audi A4' }, { navigate: vi.fn(), t: vehicleT }),
    ).toEqual([])
  })

  it('reaches every work order registry action except open, nested mechanic and task choices included', () => {
    const definitions = createWorkshopOrderRowActions(t)
    const row: WorkshopOrderListRow = {
      id: 'order-1',
      orderNo: 'WO-1',
      status: 'INTAKE',
      customer: 'Ada',
      vehicle: 'Audi',
      openedAt: '2026-01-01',
      mechanicId: null,
      tasks: [
        { id: 'task-1', title: 'Oil', lineItemsVersion: 0, status: 'IN_PROGRESS', done: false, lineItems: [] },
      ],
    }
    const context = {
      navigate: vi.fn(),
      generatePdf: { mutateAsync: vi.fn() },
      t,
      mechanics: [{ id: 'mech-1', name: 'Max' }],
      assignMechanic: vi.fn(),
      updateTaskStatus: vi.fn(),
    } as unknown as WorkshopOrderRowActionContext

    const available = filterEntityActions(definitions, 'ADMIN', row).filter(
      (definition) => definition.id !== ENTITY_ACTION_IDS.workOrderOpen,
    )
    const expectedIds = available.flatMap((definition) => [
      definition.id,
      ...collectChildIds(resolveEntityActionChildren(definition.children, row, context), row, context),
    ])

    const actions = buildPeekMenuActions(definitions, 'ADMIN', row, context)

    expect(collectIds(actions).sort()).toEqual(expectedIds.sort())
    expect(collectIds(actions)).not.toContain(ENTITY_ACTION_IDS.workOrderOpen)
    expect(collectIds(actions)).toContain(`${ENTITY_ACTION_IDS.workOrderAssignMechanic}.mech1`)
  })

  it('drops actions whose nested choices are empty in the peek', () => {
    const definitions = createWorkshopOrderRowActions(t)
    const row = {
      id: 'order-1',
      orderNo: 'WO-1',
      status: 'INTAKE',
      customer: 'Ada',
      vehicle: 'Audi',
      openedAt: '2026-01-01',
      tasks: [],
    } as WorkshopOrderListRow
    const context = { navigate: vi.fn(), generatePdf: { mutateAsync: vi.fn() }, t } as unknown as WorkshopOrderRowActionContext

    const ids = collectIds(buildPeekMenuActions(definitions, 'ADMIN', row, context))

    expect(ids).not.toContain(ENTITY_ACTION_IDS.workOrderAssignMechanic)
    expect(ids).toContain(ENTITY_ACTION_IDS.workOrderCheckIn)
  })
})
