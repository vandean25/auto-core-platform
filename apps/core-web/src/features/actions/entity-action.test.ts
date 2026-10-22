import { describe, expect, it, vi } from 'vitest'

import { filterEntityActions, toDataTableContextActions, type EntityActionDefinition } from './entity-action'

type Record = { id: string; status: string }
type Context = { navigate: (path: string) => void }

const definitions: EntityActionDefinition<Record, Context>[] = [
  {
    id: 'open',
    label: 'Open',
    isAllowedForRole: (role) => role !== 'MECHANIC',
    isEnabled: () => true,
    run: (record, { navigate }) => navigate(`/items/${record.id}`),
  },
  {
    id: 'archive',
    label: 'Archive',
    isAllowedForRole: () => true,
    isEnabled: (record) => record.status === 'OPEN',
    run: vi.fn(),
  },
]

describe('entity action registry helpers', () => {
  it('filters actions by role and enabled state', () => {
    const allowed = filterEntityActions(definitions, 'ADMIN', { id: '1', status: 'OPEN' })
    expect(allowed.map((action) => action.id)).toEqual(['open', 'archive'])

    const mechanic = filterEntityActions(definitions, 'MECHANIC', { id: '1', status: 'OPEN' })
    expect(mechanic.map((action) => action.id)).toEqual(['archive'])

    const closed = filterEntityActions(definitions, 'ADMIN', { id: '1', status: 'DONE' })
    expect(closed.map((action) => action.id)).toEqual(['open'])
  })

  it('maps registry actions to DataTable context menu actions and runs handlers', () => {
    const navigate = vi.fn()
    const record = { id: 'order-1', status: 'OPEN' }
    const menuActions = toDataTableContextActions(definitions, 'ADMIN', record, { navigate })

    expect(menuActions.map((action) => action.label)).toEqual(['Open', 'Archive'])
    menuActions[0].onClick(record)
    expect(navigate).toHaveBeenCalledWith('/items/order-1')
  })
})
