import { describe, expect, it, vi } from 'vitest'

import { isWorkshopCheckInOpenStatus } from './action-role-predicates'
import { ENTITY_ACTION_IDS, filterEntityActions } from './entity-action'
import {
  createWorkshopOrderRowActions,
  type WorkshopOrderListRow,
} from './work-order-row-actions'

const t = ((key: string) => key) as import('i18next').TFunction<'workshop'>

describe('work order row actions', () => {
  const definitions = createWorkshopOrderRowActions(t)
  const row: WorkshopOrderListRow = {
    id: 'order-1',
    orderNo: 'WO-1',
    status: 'INTAKE' as const,
    customer: 'Ada Lovelace',
    vehicle: '2024 Audi A4',
    openedAt: '2026-01-01',
  }

  it('exposes open, check-in and PDF actions for standard roles', () => {
    const actions = filterEntityActions(definitions, 'ADMIN', row)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.workOrderOpen,
      ENTITY_ACTION_IDS.workOrderCheckIn,
      ENTITY_ACTION_IDS.workOrderJobCardPdf,
    ])
  })

  it('disables check-in when the order is no longer open for intake', () => {
    const invoiced: WorkshopOrderListRow = { ...row, status: 'INVOICED' }
    const actions = filterEntityActions(definitions, 'ADMIN', invoiced)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.workOrderOpen,
      ENTITY_ACTION_IDS.workOrderJobCardPdf,
    ])
    expect(isWorkshopCheckInOpenStatus(invoiced.status)).toBe(false)
  })

  it('navigates to the order detail when open runs', () => {
    const navigate = vi.fn()
    const open = definitions.find((action) => action.id === ENTITY_ACTION_IDS.workOrderOpen)
    open?.run(row, { navigate, generatePdf: { mutateAsync: vi.fn() } as never, t })
    expect(navigate).toHaveBeenCalledWith('/workshop/orders/order-1')
  })
})
