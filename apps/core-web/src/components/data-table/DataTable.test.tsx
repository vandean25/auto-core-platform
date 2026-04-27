import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './DataTable'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DataTable Characterization', () => {
  const columns = [
    {
      accessorKey: 'name',
      header: 'Name',
    },
  ]
  const data = [{ name: 'Test Item' }]
  const mockSetColumnFilters = vi.fn()
  const mockSetGlobalFilter = vi.fn()

  const defaultProps = {
    columns,
    data,
    columnFilters: [],
    setColumnFilters: mockSetColumnFilters,
    sorting: [],
    setSorting: vi.fn(),
    pagination: { pageIndex: 0, pageSize: 10 },
    setPagination: vi.fn(),
    setGlobalFilter: mockSetGlobalFilter,
    globalFilter: '',
    searchColumn: 'name',
    searchPlaceholder: 'Search items...',
  }

  it('calls setColumnFilters when column search input changes', () => {
    render(<DataTable {...defaultProps} />)

    const input = screen.getByPlaceholderText('Search items...')
    fireEvent.change(input, { target: { value: 'test' } })

    expect(mockSetColumnFilters).toHaveBeenCalled()
    expect(mockSetGlobalFilter).not.toHaveBeenCalled()
  })

  it('renders data correctly', () => {
    render(<DataTable {...defaultProps} />)
    expect(screen.getAllByText('Test Item')).toHaveLength(1)
  })
})
