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

  it('shows Delete on right-click when getRowContextActions returns it', () => {
    render(
      <DataTable
        {...defaultProps}
        getRowContextActions={() => [
          {
            label: 'Delete',
            onClick: vi.fn(),
            destructive: true,
          },
        ]}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Test Item'))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not open a context menu when getRowContextActions returns no actions', () => {
    render(
      <DataTable
        {...defaultProps}
        getRowContextActions={() => []}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Test Item'))

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('does not open a context menu when getRowContextActions is omitted', () => {
    render(<DataTable {...defaultProps} />)

    fireEvent.contextMenu(screen.getByText('Test Item'))

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('invokes the Delete action with the row when the context menu item is clicked', () => {
    const onDelete = vi.fn()
    render(
      <DataTable
        {...defaultProps}
        getRowContextActions={() => [
          {
            label: 'Delete',
            onClick: onDelete,
            destructive: true,
          },
        ]}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Test Item'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith({ name: 'Test Item' })
  })
})
