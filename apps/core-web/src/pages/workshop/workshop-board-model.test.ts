import { describe, expect, it } from 'vitest'
import { buildQuickAssignTargets, buildWorkshopBoardColumns } from './workshop-board-model'
import { WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'
import type { BoardOrder } from '@/api/workshop'

const order: BoardOrder = {
  id: 'o1',
  orderNumber: 'WO-1',
  status: 'INTAKE',
  customer: null,
  vehicle: { id: 'v', make: 'Skoda', model: 'Octavia', year: 2020, plate: null },
  mechanicId: 'm1',
  bayId: null,
  stagingLocationId: null,
  partsStatus: 'NO_PARTS',
  tasks: [],
  createdAt: '',
  updatedAt: '',
}

describe('workshop-board-model', () => {
  it('builds mechanic and bay assign targets', () => {
    const targets = buildQuickAssignTargets({
      mechanics: [{ id: 'm1', name: 'Alex', isActive: true, sortOrder: 1, role: 'MECHANIC' }],
      bays: [{ id: 'b1', name: 'Bay 1', isActive: true, sortOrder: 1 }],
    })
    expect(targets).toHaveLength(2)
    expect(targets[0]).toMatchObject({ kind: 'mechanic', id: 'm1' })
  })

  it('groups orders into resource columns and unassigned', () => {
    const columns = buildWorkshopBoardColumns(
      'mechanic',
      [{ id: 'm1', name: 'Alex' }],
      [order, { ...order, id: 'o2', mechanicId: null }],
      'Nicht zugewiesen',
    )
    expect(columns).toHaveLength(2)
    expect(columns[0].orders).toHaveLength(1)
    expect(columns[1].id).toBe(WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID)
    expect(columns[1].orders).toHaveLength(1)
  })
})
