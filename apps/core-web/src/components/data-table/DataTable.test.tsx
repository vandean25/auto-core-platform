import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './DataTable'
import { DataTableColumnHeader } from './data-table-column-header'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

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

  it('renders a row detail link and activates it with Enter when getRowHref is provided', () => {
    const onRowClick = vi.fn()
    const columnsWithRowLink = [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { rowLink: true },
      },
    ]

    render(
      <MemoryRouter>
        <DataTable
          {...defaultProps}
          columns={columnsWithRowLink}
          data={[{ id: 'item-1', name: 'Test Item' }]}
          getRowHref={(row) => `/items/${row.id}`}
          getRowAccessibleName={(row) => `Open ${row.name}`}
          onRowClick={onRowClick}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Open Test Item' })
    expect(link).toHaveAttribute('href', '/items/item-1')

    const row = screen.getByRole('row', { name: /Test Item/ })
    expect(row).not.toHaveAttribute('tabindex')

    link.focus()
    fireEvent.keyDown(link, { key: 'Enter' })
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('keeps the row detail link at least 24px tall so its hit area meets WCAG 2.5.8', () => {
    const columnsWithRowLink = [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { rowLink: true },
      },
    ]

    render(
      <MemoryRouter>
        <DataTable
          {...defaultProps}
          columns={columnsWithRowLink}
          data={[{ id: 'item-1', name: 'Test Item' }]}
          getRowHref={(row) => `/items/${row.id}`}
          getRowAccessibleName={(row) => `Open ${row.name}`}
          onRowClick={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Open Test Item' })).toHaveClass('inline-flex', 'min-h-6')
  })

  it('navigates when the row detail link is clicked', () => {
    const onRowClick = vi.fn()
    const columnsWithRowLink = [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { rowLink: true },
      },
    ]

    render(
      <MemoryRouter initialEntries={['/lists']}>
        <LocationProbe />
        <DataTable
          {...defaultProps}
          columns={columnsWithRowLink}
          data={[{ id: 'item-1', name: 'Test Item' }]}
          getRowHref={(row) => `/items/${row.id}`}
          getRowAccessibleName={(row) => `Open ${row.name}`}
          onRowClick={onRowClick}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Open Test Item' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/items/item-1')
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('falls back to row keyboard activation when getRowHref is set without meta.rowLink', () => {
    const onRowClick = vi.fn()

    render(
      <MemoryRouter>
        <DataTable
          {...defaultProps}
          data={[{ id: 'item-1', name: 'Test Item' }]}
          getRowHref={(row) => `/items/${row.id}`}
          getRowAccessibleName={(row) => `Open ${row.name}`}
          onRowClick={onRowClick}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'Open Test Item' })).not.toBeInTheDocument()

    const row = screen.getByRole('row', { name: /Test Item/ })
    expect(row).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onRowClick).toHaveBeenCalledWith({ id: 'item-1', name: 'Test Item' })
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

  it('resolves cell clicks from the clicked row data attribute', () => {
    const customers = [
      { id: 'cust-klaus', label: 'Klaus Kombi' },
      { id: 'cust-susi', label: 'Susi Sorglos' },
    ]
    const onRowClick = vi.fn()

    render(
      <DataTable
        {...defaultProps}
        columns={[{ accessorKey: 'label', header: 'Name' }]}
        data={customers}
        onRowClick={onRowClick}
      />,
    )

    const clickedCell = screen.getByText('Klaus Kombi')
    clickedCell.closest('tr')?.setAttribute('data-row-id', 'cust-susi')

    fireEvent.click(clickedCell)

    expect(onRowClick).toHaveBeenCalledWith(customers[1])
  })

  it('activates ordinary row clicks but leaves interactive descendants in control', () => {
    const onRowClick = vi.fn()
    const columnsWithAction = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }: { row: { original: { name: string } } }) => (
          <div>
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

    fireEvent.click(screen.getByText('Test Item'))
    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
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

type PartRow = {
  id: string
  sku: string
  warehouse_location: string
  customerName: string
  notes: string
}

const partRows: PartRow[] = [
  {
    id: 'part-1',
    sku: '06J-115-403-Q',
    warehouse_location: 'Bin A-01',
    customerName: 'Gruber',
    notes: 'Fast mover',
  },
]

const partColumns: ColumnDef<PartRow>[] = [
  {
    accessorKey: 'sku',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Part" />,
    meta: { label: 'SKU' },
  },
  {
    accessorKey: 'warehouse_location',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Storage Location" />,
    meta: { label: 'Warehouse location' },
  },
  {
    accessorKey: 'customerName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    enableSorting: false,
  },
]

function ColumnPickerHarness({ columns = partColumns }: { columns?: ColumnDef<PartRow>[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  return (
    <>
      <output data-testid="sorting">{JSON.stringify(sorting)}</output>
      <DataTable
        columns={columns}
        data={partRows}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        sorting={sorting}
        setSorting={setSorting}
        pagination={pagination}
        setPagination={setPagination}
      />
    </>
  )
}

function openColumnsMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Columns' }), { key: 'Enter' })
}

// Radix marks the page aria-hidden while a menu is open, so close it before asserting on the table.
function closeOpenMenu() {
  fireEvent.keyDown(document.querySelector('[role="menu"]') as Element, { key: 'Escape' })
}

describe('DataTable column picker and sorting', () => {
  it('lists readable labels in the Columns menu instead of raw column ids', () => {
    render(<ColumnPickerHarness />)

    openColumnsMenu()

    expect(screen.getByRole('menuitemcheckbox', { name: 'SKU' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Warehouse location' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Customer name' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'warehouse_location' })).not.toBeInTheDocument()
  })

  it('keeps the Columns picker visible at every breakpoint', () => {
    render(<ColumnPickerHarness />)

    const trigger = screen.getByRole('button', { name: 'Columns' })
    expect(trigger).not.toHaveClass('hidden')
    expect(trigger).not.toHaveClass('lg:flex')
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument()
  })

  it('Show all reveals every hidden column', () => {
    render(<ColumnPickerHarness />)

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Warehouse location' }))
    closeOpenMenu()
    expect(screen.queryByRole('columnheader', { name: /Storage Location/ })).not.toBeInTheDocument()

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show all' }))
    closeOpenMenu()
    expect(screen.getByRole('columnheader', { name: /Storage Location/ })).toBeInTheDocument()
  })

  it('Reset restores the default column layout', () => {
    render(<ColumnPickerHarness />)

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Customer name' }))
    closeOpenMenu()
    expect(screen.queryByRole('columnheader', { name: /Customer/ })).not.toBeInTheDocument()

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset' }))
    closeOpenMenu()
    expect(screen.getByRole('columnheader', { name: /Customer/ })).toBeInTheDocument()
  })

  it('sorts ascending on the first click, descending on the second, and clears on the third', () => {
    render(<ColumnPickerHarness />)

    const header = () => screen.getByRole('columnheader', { name: /Part/ })
    const sortButton = () => screen.getByRole('button', { name: 'Part' })

    expect(header()).toHaveAttribute('aria-sort', 'none')

    fireEvent.click(sortButton())
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByTestId('sorting')).toHaveTextContent('[{"id":"sku","desc":false}]')

    fireEvent.click(sortButton())
    expect(header()).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByTestId('sorting')).toHaveTextContent('[{"id":"sku","desc":true}]')

    fireEvent.click(sortButton())
    expect(header()).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByTestId('sorting')).toHaveTextContent('[]')
  })

  it('keeps Hide in the column header menu', () => {
    render(<ColumnPickerHarness />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Part column options' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide' }))

    expect(screen.queryByRole('columnheader', { name: /Part/ })).not.toBeInTheDocument()
  })

  it('omits aria-sort on columns that cannot be sorted', () => {
    render(<ColumnPickerHarness />)

    expect(screen.getByRole('columnheader', { name: 'Notes' })).not.toHaveAttribute('aria-sort')
  })

  it('omits aria-sort on sortable columns whose header is plain text, which have no sort control', () => {
    render(<ColumnPickerHarness columns={[{ accessorKey: 'notes', header: 'Notes' }]} />)

    expect(screen.getByRole('columnheader', { name: 'Notes' })).not.toHaveAttribute('aria-sort')
  })
})
