import { describe, expect, it } from 'vitest'

import { createTyreStorageListColumns } from './tyre-storage-list-columns'

describe('createTyreStorageListColumns', () => {
  const t = ((key: string) => key) as never

  it('includes phone and email columns only in due view', () => {
    const allColumns = createTyreStorageListColumns({ t, emDash: '—', viewMode: 'all' })
    const dueColumns = createTyreStorageListColumns({ t, emDash: '—', viewMode: 'due' })
    const keys = (columns: ReturnType<typeof createTyreStorageListColumns>) =>
      columns
        .map((col) => ('accessorKey' in col ? col.accessorKey : undefined))
        .filter(Boolean)
    expect(keys(allColumns)).not.toContain('customerPhone')
    expect(keys(dueColumns)).toEqual(expect.arrayContaining(['customerPhone', 'customerEmail']))
    expect(dueColumns.length).toBe(allColumns.length + 2)
  })
})
