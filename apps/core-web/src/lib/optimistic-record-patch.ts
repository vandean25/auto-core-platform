type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function mapRows(rows: unknown[], id: string, change: (row: Row) => Row): unknown[] {
  return rows.map((row) => (isRow(row) && row.id === id ? change(row) : row))
}

/**
 * Applies `change` to the record `id` wherever a query cache holds it: a detail object, a `{ data: rows }` offset page,
 * a plain row array or the pages of an infinite list. Other records and the cache shape stay as they are.
 */
export function mapRecordInCache(cache: unknown, id: string, change: (row: Row) => Row): unknown {
  if (Array.isArray(cache)) return mapRows(cache, id, change)
  if (!isRow(cache)) return cache
  if (cache.id === id) return change(cache)
  if (Array.isArray(cache.data)) return { ...cache, data: mapRows(cache.data, id, change) }
  if (Array.isArray(cache.pages)) return { ...cache, pages: cache.pages.map((page) => mapRecordInCache(page, id, change)) }
  return cache
}

export function findRecordInCache(cache: unknown, id: string): Row | undefined {
  let found: Row | undefined
  mapRecordInCache(cache, id, (row) => {
    found ??= row
    return row
  })
  return found
}

/** Optimistic `apply`: merges the edited fields into the record. */
export function patchRecordInCache(cache: unknown, id: string, patch: Row): unknown {
  return mapRecordInCache(cache, id, (row) => ({ ...row, ...patch }))
}

/**
 * Optimistic `revert`: puts back only the edited fields from the snapshot, so a failure never clobbers
 * another field or record that changed meanwhile. A field the snapshot did not have is removed again.
 */
export function restoreRecordFields(cache: unknown, id: string, fields: string[], snapshot: unknown): unknown {
  const before = findRecordInCache(snapshot, id)
  if (!before) return cache
  return mapRecordInCache(cache, id, (row) => {
    const restored = { ...row }
    for (const field of fields) {
      if (field in before) restored[field] = before[field]
      else delete restored[field]
    }
    return restored
  })
}
