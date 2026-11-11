import type { UseQueryResult } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { offsetListTableProps } from './offset-list-table-props'

describe('offsetListTableProps', () => {
  it('wires onRetry when the offset query failed without data', () => {
    const refetch = vi.fn(async () => ({ data: undefined }))
    const props = offsetListTableProps({
      data: undefined,
      refetch: refetch as unknown as UseQueryResult<{ meta: { pageCount: number } }>['refetch'],
    })
    expect(props.pageCount).toBe(1)
    expect(props.onRetry).toBeTypeOf('function')
    props.onRetry()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('uses pageCount from settled meta', () => {
    const props = offsetListTableProps({
      data: { meta: { pageCount: 4 }, data: [] } as { meta: { pageCount: number }; data: unknown[] },
      refetch: vi.fn() as unknown as UseQueryResult<{ meta: { pageCount: number } }>['refetch'],
    })
    expect(props.pageCount).toBe(4)
  })
})
