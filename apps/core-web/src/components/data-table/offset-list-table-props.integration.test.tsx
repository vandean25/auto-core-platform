import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { DataTable } from './DataTable'
import { offsetListTableProps } from './offset-list-table-props'

type Row = { id: string; name: string }
const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

describe('offsetListTableProps on failed first load', () => {
  it('shows the inline fetch error with Retry when the helper spreads into DataTable', () => {
    const refetch = vi.fn()
    const props = offsetListTableProps({
      data: undefined,
      refetch: refetch as never,
    })

    render(
      <MemoryRouter>
        <DataTable
          columns={columns}
          data={[]}
          columnFilters={[]}
          setColumnFilters={vi.fn()}
          sorting={[]}
          setSorting={vi.fn()}
          pagination={{ pageIndex: 0, pageSize: 10 }}
          setPagination={vi.fn()}
          isLoading={false}
          isFetching={false}
          isError
          hasUsableData={false}
          {...props}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(deCommon.dataTable.loading.loadFailed)
    fireEvent.click(screen.getByRole('button', { name: deCommon.dataTable.loading.retry }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
