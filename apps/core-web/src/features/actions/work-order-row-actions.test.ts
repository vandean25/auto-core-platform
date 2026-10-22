import { describe, expect, it, vi } from 'vitest'

import {
  createWorkshopOrderRowActions,
  isWorkshopCheckInOpenStatus,
  type WorkshopOrderListRow,
} from './work-order-row-actions'
import { filterEntityActions } from './entity-action'

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
    expect(actions.map((action) => action.id)).toEqual(['open', 'checkIn', 'jobCardPdf'])
  })

  it('disables check-in when the order is no longer open for intake', () => {
    const invoiced: WorkshopOrderListRow = { ...row, status: 'INVOICED' }
    const actions = filterEntityActions(definitions, 'ADMIN', invoiced)
    expect(actions.map((action) => action.id)).toEqual(['open', 'jobCardPdf'])
    expect(isWorkshopCheckInOpenStatus(invoiced.status)).toBe(false)
  })

  it('navigates to the order detail when open runs', () => {
    const navigate = vi.fn()
    const open = definitions.find((action) => action.id === 'open')
    open?.run(row, { navigate, generatePdf: { mutateAsync: vi.fn() } as never, t })
    expect(navigate).toHaveBeenCalledWith('/workshop/orders/order-1')
  })
})
