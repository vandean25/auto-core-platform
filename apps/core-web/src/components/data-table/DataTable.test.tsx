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

  it('calls onRowClick when clicking cell text', () => {
    const onRowClick = vi.fn()
    render(<DataTable {...defaultProps} onRowClick={onRowClick} />)

    fireEvent.click(screen.getByText('Test Item'))

    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })
  })

  it('does not call onRowClick when clicking an interactive child in a cell', () => {
    const onRowClick = vi.fn()
    const columnsWithAction = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }: { row: { original: { name: string } } }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            <button type="button">Edit</button>
          </div>
        ),
      },
    ]

    render(
      <DataTable
        {...defaultProps}
        columns={columnsWithAction}
        onRowClick={onRowClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does not prevent default Enter/Space on an in-cell button', () => {
    const onRowClick = vi.fn()
    const onEdit = vi.fn()
    const columnsWithAction = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }: { row: { original: { name: string } } }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          </div>
        ),
      },
    ]

    render(
      <DataTable
        {...defaultProps}
        columns={columnsWithAction}
        onRowClick={onRowClick}
      />,
    )

    const editButton = screen.getByRole('button', { name: 'Edit' })
    editButton.focus()

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    const enterPrevented = !editButton.dispatchEvent(enterEvent)

    const spaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    const spacePrevented = !editButton.dispatchEvent(spaceEvent)

    fireEvent.click(editButton)

    expect(enterPrevented).toBe(false)
    expect(spacePrevented).toBe(false)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('calls onRowClick when the row element is clicked programmatically', () => {
    const onRowClick = vi.fn()
    const { container } = render(<DataTable {...defaultProps} onRowClick={onRowClick} />)

    const row = container.querySelector('tbody tr[data-table-row="true"]')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })
  })

  it('activates clickable rows with Enter and Space', () => {
    const onRowClick = vi.fn()
    render(<DataTable {...defaultProps} onRowClick={onRowClick} />)

    const row = screen.getByRole('row', { name: 'Test Item' })
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(row).toHaveAttribute('tabindex', '0')
    expect(onRowClick).toHaveBeenNthCalledWith(1, { name: 'Test Item' })
    expect(onRowClick).toHaveBeenNthCalledWith(2, { name: 'Test Item' })
  })

  it('opens the clicked row data for each row in a multi-row table (AUT-220)', () => {
    const customers = [
      { id: 'cust-klaus', label: 'Klaus Kombi' },
      { id: 'cust-susi', label: 'Susi Sorglos' },
      { id: 'cust-max', label: 'Max Mustermann3' },
      { id: 'cust-thomas', label: 'Thomas Turboschrauber' },
      { id: 'cust-anna', label: 'Anna Alpin' },
    ]
    const onRowClick = vi.fn()
    const { rerender } = render(
      <DataTable
        {...defaultProps}
        columns={[
          {
            accessorKey: 'label',
            header: 'Name',
          },
        ]}
        data={customers}
        onRowClick={onRowClick}
      />,
    )

    for (const customer of customers) {
      fireEvent.click(screen.getByText(customer.label))
    }

    expect(onRowClick).toHaveBeenCalledTimes(customers.length)
    for (const [index, customer] of customers.entries()) {
      expect(onRowClick).toHaveBeenNthCalledWith(index + 1, customer)
    }

    onRowClick.mockClear()
    const reordered = [...customers].reverse()
    rerender(
      <DataTable
        {...defaultProps}
        columns={[
          {
            accessorKey: 'label',
            header: 'Name',
          },
        ]}
        data={reordered}
        onRowClick={onRowClick}
      />,
    )

    fireEvent.click(screen.getByText('Max Mustermann3'))
    expect(onRowClick).toHaveBeenCalledWith({ id: 'cust-max', label: 'Max Mustermann3' })
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
