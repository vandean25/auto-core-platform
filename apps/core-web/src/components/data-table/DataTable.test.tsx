import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { DataTable } from './DataTable'

describe('DataTable Characterization', () => {
  const columns = [
    {
      accessorKey: 'name',
      header: 'Name',
    },
  ]
  const data = [{ name: 'Test Item' }]
  const mockSetGlobalFilter = vi.fn()

  const defaultProps = {
    columns,
    data,
    columnFilters: [],
    setColumnFilters: vi.fn(),
    sorting: [],
    setSorting: vi.fn(),
    pagination: { pageIndex: 0, pageSize: 10 },
    setPagination: vi.fn(),
    setGlobalFilter: mockSetGlobalFilter,
    globalFilter: '',
    searchColumn: 'name',
    searchPlaceholder: 'Search items...',
  }

  it('calls setGlobalFilter when search input changes', () => {
    render(<DataTable {...defaultProps} />)
    
    const input = screen.getByPlaceholderText('Search items...')
    fireEvent.change(input, { target: { value: 'test' } })
    
    expect(mockSetGlobalFilter).toHaveBeenCalled()
  })

  it('renders data correctly', () => {
    render(<DataTable {...defaultProps} />)
    expect(screen.getByText('Test Item')).toBeInTheDocument()
  })
})
