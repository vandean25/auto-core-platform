import { describe, expect, it } from 'vitest'

import { buildDataTableUrl } from './data-table-query'

const params = { page: 2, pageSize: 200, filters: [] }

describe('buildDataTableUrl page size', () => {
  it('never asks for more than the cap of the endpoint (AUT-807)', () => {
    expect(buildDataTableUrl('/api/customers', params)).toContain('pageSize=100')
    expect(buildDataTableUrl('/api/vehicles', params, { maxPageSize: 50 })).toContain('pageSize=50')
    expect(buildDataTableUrl('/api/vehicles', { ...params, pageSize: 25 }, { maxPageSize: 50 })).toContain('pageSize=25')
  })
})
