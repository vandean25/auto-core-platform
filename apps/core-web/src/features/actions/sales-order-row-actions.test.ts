import { describe, expect, it, vi } from 'vitest'

import type { SalesOrder } from '@/api/types'
import {
  canDeleteSalesOrder,
  isSalesOrderDraftDeletable,
} from './action-role-predicates'
import { createSalesOrderRowActions } from './sales-order-row-actions'
import { ENTITY_ACTION_IDS, filterEntityActions } from './entity-action'

const t = ((key: string) => key) as import('i18next').TFunction<'sales'>

const draftOrder = {
  id: 'so-1',
  status: 'DRAFT',
  invoice: null,
} as SalesOrder

const confirmedOrder = {
  id: 'so-2',
  status: 'CONFIRMED',
  invoice: null,
} as SalesOrder

describe('sales order row actions', () => {
  const definitions = createSalesOrderRowActions(t)

  it('gates delete to back-office roles and draft orders without an invoice', () => {
    expect(canDeleteSalesOrder('TECH')).toBe(false)
    expect(canDeleteSalesOrder('SALES')).toBe(true)
    expect(isSalesOrderDraftDeletable(draftOrder)).toBe(true)
    expect(isSalesOrderDraftDeletable(confirmedOrder)).toBe(false)
    expect(isSalesOrderDraftDeletable({ ...draftOrder, invoice: { id: 'inv-1' } } as SalesOrder)).toBe(
      false,
    )

    const allowed = filterEntityActions(definitions, 'ADMIN', draftOrder)
    expect(allowed.map((action) => action.id)).toEqual([ENTITY_ACTION_IDS.salesOrderDelete])
    expect(filterEntityActions(definitions, 'TECH', draftOrder)).toEqual([])
    expect(filterEntityActions(definitions, 'ADMIN', confirmedOrder)).toEqual([])
  })

  it('configures confirm on delete and calls the delete handler', () => {
    const del = definitions.find((action) => action.id === ENTITY_ACTION_IDS.salesOrderDelete)
    expect(del?.destructive).toBe(true)
    expect(del?.confirm).toEqual({
      title: 'orders.list.deleteConfirmTitle',
      description: 'orders.list.deleteConfirm',
      confirmLabel: 'shared.delete',
    })

    const onDelete = vi.fn()
    del?.run(draftOrder, { navigate: vi.fn(), onDelete, t })
    expect(onDelete).toHaveBeenCalledWith('so-1')
  })
})
