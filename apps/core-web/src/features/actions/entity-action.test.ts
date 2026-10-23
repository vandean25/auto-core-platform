import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { EntityActionConfirmHost } from './action-confirm-host'
import { createCustomerRowActions } from './customer-row-actions'
import {
  ENTITY_ACTION_IDS,
  executeEntityAction,
  filterEntityActions,
  isRegisteredEntityActionId,
  isValidEntityActionId,
  REGISTERED_ENTITY_ACTION_IDS,
  resolveEntityActionChildren,
  toDataTableContextActions,
  type EntityActionDefinition,
} from './entity-action'
import { createVehicleRowActions } from './vehicle-row-actions'
import { createWorkshopOrderRowActions } from './work-order-row-actions'

type RecordItem = { id: string; status: string }
type Context = { navigate: (path: string) => void }

const definitions: EntityActionDefinition<RecordItem, Context>[] = [
  {
    id: 'item.open',
    kind: 'navigate',
    label: 'Open',
    isAllowedForRole: (role) => role !== 'MECHANIC',
    isEnabled: () => true,
    run: (record, { navigate }) => navigate(`/items/${record.id}`),
  },
  {
    id: 'item.archive',
    kind: 'run',
    label: 'Archive',
    isAllowedForRole: () => true,
    isEnabled: (record) => record.status === 'OPEN',
    run: vi.fn(),
  },
]

const passthroughT = (key: string) => key

describe('entity action registry helpers', () => {
  afterEach(cleanup)

  it('filters actions by role and enabled state', () => {
    const allowed = filterEntityActions(definitions, 'ADMIN', { id: '1', status: 'OPEN' })
    expect(allowed.map((action) => action.id)).toEqual(['item.open', 'item.archive'])

    const mechanic = filterEntityActions(definitions, 'MECHANIC', { id: '1', status: 'OPEN' })
    expect(mechanic.map((action) => action.id)).toEqual(['item.archive'])

    const closed = filterEntityActions(definitions, 'ADMIN', { id: '1', status: 'DONE' })
    expect(closed.map((action) => action.id)).toEqual(['item.open'])
  })

  it('maps registry actions to DataTable context menu actions and runs handlers', () => {
    const navigate = vi.fn()
    const record = { id: 'order-1', status: 'OPEN' }
    const menuActions = toDataTableContextActions(definitions, 'ADMIN', record, { navigate })

    expect(menuActions.map((action) => action.label)).toEqual(['Open', 'Archive'])
    menuActions[0].onClick(record)
    expect(navigate).toHaveBeenCalledWith('/items/order-1')
  })

  it('validates <entity>.<action> ids (including multi-segment child ids) and enforces confirm on every destructive registry action', () => {
    expect(isValidEntityActionId(ENTITY_ACTION_IDS.customerDelete)).toBe(true)
    expect(isValidEntityActionId('workOrder.taskState.t1.done')).toBe(true)
    expect(isValidEntityActionId('delete')).toBe(false)
    expect(isValidEntityActionId('Customer.delete')).toBe(false)
    expect(isValidEntityActionId('customer.')).toBe(false)
    expect(isValidEntityActionId('customer..delete')).toBe(false)
    expect(isValidEntityActionId('.delete')).toBe(false)
    expect(isRegisteredEntityActionId(ENTITY_ACTION_IDS.workOrderJobCardPdf)).toBe(true)
    expect(isRegisteredEntityActionId('unknown.action')).toBe(false)

    const allRegistered = [
      ...createCustomerRowActions(passthroughT as TFunction<'customers'>),
      ...createWorkshopOrderRowActions(passthroughT as TFunction<'workshop'>),
      ...createVehicleRowActions(passthroughT as TFunction<'vehicles'>),
    ]

    expect(allRegistered.map((action) => action.id)).toEqual([...REGISTERED_ENTITY_ACTION_IDS])
    for (const action of allRegistered) {
      expect(isRegisteredEntityActionId(action.id)).toBe(true)
      if (action.destructive) {
        expect(action.confirm).toBeDefined()
      }
    }
  })

  it('resolves static and function children definitions', () => {
    const record = { id: '1', status: 'OPEN' }
    const context = { navigate: vi.fn() }
    const child = { id: 'item.child', label: 'Child', run: vi.fn() }

    expect(resolveEntityActionChildren([child], record, context)).toEqual([child])
    expect(resolveEntityActionChildren(() => [child], record, context)).toEqual([child])
    expect(resolveEntityActionChildren(undefined, record, context)).toBeUndefined()
  })

  it('opens the shared confirm host for actions with confirm; Cancel skips run and Confirm calls run once', () => {
    const windowConfirm = vi.spyOn(window, 'confirm')
    const run = vi.fn()
    const destructiveAction: EntityActionDefinition<RecordItem, Context> = {
      id: 'item.delete',
      kind: 'run',
      label: 'Delete item',
      destructive: true,
      confirm: {
        title: 'Eintrag löschen',
        description: 'Diesen Eintrag wirklich löschen?',
      },
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run,
    }

    render(createElement(EntityActionConfirmHost))

    act(() => {
      executeEntityAction(destructiveAction, { id: '1', status: 'OPEN' }, { navigate: vi.fn() })
    })
    expect(run).not.toHaveBeenCalled()
    expect(windowConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Diesen Eintrag wirklich löschen?')

    fireEvent.click(screen.getByRole('button', { name: deCommon.actions.cancel }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    act(() => {
      executeEntityAction(destructiveAction, { id: '1', status: 'OPEN' }, { navigate: vi.fn() })
    })
    fireEvent.click(screen.getByRole('button', { name: deCommon.actions.confirm }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(windowConfirm).not.toHaveBeenCalled()
    windowConfirm.mockRestore()
  })
})
