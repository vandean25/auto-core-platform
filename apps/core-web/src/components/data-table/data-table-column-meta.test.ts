import { describe, expect, it } from 'vitest'
import { getDataTableMobileSlots, type DataTableMobileRole } from './data-table-column-meta'

const col = (id: string, mobile?: DataTableMobileRole, accessor = true) => ({
  id,
  accessorFn: accessor ? () => id : undefined,
  columnDef: { meta: mobile ? { mobile } : undefined },
})

describe('getDataTableMobileSlots', () => {
  it('maps annotated columns to their slot and ignores hidden ones', () => {
    const slots = getDataTableMobileSlots([
      col('orderNo', 'trailing'),
      col('customer', 'title'),
      col('vehicle', 'subtitle'),
      col('opened', 'hidden'),
      col('status', 'status'),
    ])
    expect(slots).toEqual({ title: 'customer', subtitle: 'vehicle', status: 'status', trailing: 'orderNo' })
  })

  it('keeps the first column per role', () => {
    expect(getDataTableMobileSlots([col('a', 'title'), col('b', 'title')]).title).toBe('a')
  })

  it('falls back to the first two data columns when nothing is annotated', () => {
    const slots = getDataTableMobileSlots([
      col('select', undefined, false),
      col('icon', undefined, false),
      col('name'),
      col('city'),
      col('email'),
    ])
    expect(slots).toEqual({ title: 'name', subtitle: 'city' })
  })

  it('takes the first unassigned data column as title when only other roles are annotated', () => {
    const slots = getDataTableMobileSlots([col('name'), col('status', 'status'), col('note', 'hidden')])
    expect(slots).toEqual({ title: 'name', status: 'status' })
  })
})
