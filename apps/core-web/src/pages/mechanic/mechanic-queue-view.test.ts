// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { MechanicQueueItem } from '@/api/mechanic'
import { filterMechanicQueue, getMechanicQueueView } from './mechanic-queue-view'

const baseItem: MechanicQueueItem = {
  taskId: '22222222-2222-2222-2222-222222222222',
  taskTitle: 'Oil Change',
  taskStatus: 'NOT_STARTED',
  orderId: 'order-1',
  orderNumber: 'WO-2026-0001',
  reportedComplaint: null,
  vehicle: { id: 'v1', make: 'BMW', model: '320d', year: 2022, plate: 'W-TEST-1' },
  bay: null,
  sequence: 1,
  scheduledDate: null,
  partLines: [],
  updatedAt: '2026-04-28T10:00:00.000Z',
}

describe('filterMechanicQueue', () => {
  const items = [
    baseItem,
    {
      ...baseItem,
      taskId: '33333333-3333-3333-3333-333333333333',
      taskTitle: 'Brake pads',
      orderNumber: 'WO-2026-0099',
      vehicle: { ...baseItem.vehicle, plate: null, make: 'Audi', model: 'A4', year: 2019 },
    },
  ]

  it('returns all items when search is blank', () => {
    expect(filterMechanicQueue(items, '')).toEqual(items)
    expect(filterMechanicQueue(items, '   ')).toEqual(items)
  })

  it('matches case-insensitively with trimmed search', () => {
    expect(filterMechanicQueue(items, '  oil  ')).toEqual([items[0]])
    expect(filterMechanicQueue(items, 'WO-2026-0099')).toEqual([items[1]])
  })

  it('matches title, order number, plate and year make model', () => {
    expect(filterMechanicQueue(items, 'brake')).toEqual([items[1]])
    expect(filterMechanicQueue(items, 'w-test-1')).toEqual([items[0]])
    expect(filterMechanicQueue(items, '2019 audi a4')).toEqual([items[1]])
  })

  it('handles a null plate safely', () => {
    expect(filterMechanicQueue(items, 'audi')).toEqual([items[1]])
  })
})

describe('getMechanicQueueView', () => {
  it('returns loading even when an error is present', () => {
    expect(
      getMechanicQueueView({
        isLoading: true,
        queueError: { response: { status: 500 } },
        itemCount: 0,
        hasSearch: false,
      }),
    ).toBe('loading')
  })

  it('returns identity-error for a 404 queue error', () => {
    expect(
      getMechanicQueueView({
        isLoading: false,
        queueError: { response: { status: 404 } },
        itemCount: 0,
        hasSearch: false,
      }),
    ).toBe('identity-error')
  })

  it('returns load-error for other queue errors', () => {
    expect(
      getMechanicQueueView({
        isLoading: false,
        queueError: { response: { status: 500 } },
        itemCount: 0,
        hasSearch: false,
      }),
    ).toBe('load-error')
  })

  it('returns no-results when filtered list is empty with active search', () => {
    expect(
      getMechanicQueueView({
        isLoading: false,
        queueError: null,
        itemCount: 0,
        hasSearch: true,
      }),
    ).toBe('no-results')
  })

  it('returns empty when there are no items and no search', () => {
    expect(
      getMechanicQueueView({
        isLoading: false,
        queueError: null,
        itemCount: 0,
        hasSearch: false,
      }),
    ).toBe('empty')
  })

  it('returns list when items are present', () => {
    expect(
      getMechanicQueueView({
        isLoading: false,
        queueError: null,
        itemCount: 3,
        hasSearch: false,
      }),
    ).toBe('list')
  })
})
