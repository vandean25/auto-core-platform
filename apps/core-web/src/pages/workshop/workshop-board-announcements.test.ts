import { describe, expect, it } from 'vitest'
import { createWorkshopBoardAnnouncements, WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID } from './workshop-board-announcements'
import type { BoardOrder } from '@/api/workshop'

const sampleOrder: BoardOrder = {
  id: 'order-1',
  orderNumber: 'WO-TEST-001',
  status: 'INTAKE',
  customer: null,
  vehicle: { id: 'v1', make: 'Skoda', model: 'Octavia', year: 2020, plate: null },
  mechanicId: null,
  bayId: null,
  stagingLocationId: null,
  partsStatus: 'NO_PARTS',
  tasks: [],
  createdAt: '',
  updatedAt: '',
}

describe('createWorkshopBoardAnnouncements', () => {
  it('names columns in drag announcements', () => {
    const announcements = createWorkshopBoardAnnouncements(
      [sampleOrder],
      [
        { id: 'mech-a', label: 'Alex' },
        { id: WORKSHOP_BOARD_UNASSIGNED_COLUMN_ID, label: 'Unassigned' },
      ],
      'mechanic',
    )

    expect(announcements.onDragStart?.({ active: { id: 'order-1' } })).toContain('WO-TEST-001')
    expect(
      announcements.onDragOver?.({ active: { id: 'order-1' }, over: { id: 'mech-a' } }),
    ).toContain('mechanic Alex')
  })
})
