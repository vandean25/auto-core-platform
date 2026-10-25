import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './DataTable'
import { DataTableColumnHeader } from './data-table-column-header'
import { triggerBlobDownload } from '@/lib/download'
import deCommon from '../../../../../locales/de/common.json'

const dt = deCommon.dataTable
const columnOptionsLabel = (title: string) => dt.columnOptions.replace('{{title}}', title)

vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))

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
    render(<DataTable {...defaultProps} rowBehaviour={{ onRowClick }} />)

    fireEvent.click(screen.getByText('Test Item'))

    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })
  })

  it('prefetches on mouse pointerenter and skips touch pointerenter', () => {
    const onRowPrefetch = vi.fn()
    const { container } = render(
      <DataTable {...defaultProps} rowBehaviour={{ onRowPrefetch }} />,
    )

    const row = container.querySelector('tbody tr[data-table-row="true"]')
    expect(row).not.toBeNull()

    fireEvent.pointerEnter(row!, { pointerType: 'touch' })
    expect(onRowPrefetch).not.toHaveBeenCalled()

    fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
    expect(onRowPrefetch).toHaveBeenCalledWith({ name: 'Test Item' })
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
        rowBehaviour={{ onRowClick }}
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
        rowBehaviour={{ onRowClick }}
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
    const { container } = render(<DataTable {...defaultProps} rowBehaviour={{ onRowClick }} />)

    const row = container.querySelector('tbody tr[data-table-row="true"]')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    expect(onRowClick).toHaveBeenCalledWith({ name: 'Test Item' })
  })

  it('activates clickable rows with Enter and Space', () => {
    const onRowClick = vi.fn()
    render(<DataTable {...defaultProps} rowBehaviour={{ onRowClick }} />)

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
          rowBehaviour={{
            getRowHref: (row) => `/items/${row.id}`,
            getRowAccessibleName: (row) => `Open ${row.name}`,
            onRowClick,
          }}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Open Test Item' })
    expect(link).toHaveAttribute('href', '/items/item-1')

    const row = screen.getByRole('row', { name: /Test Item/ })
    expect(row).toHaveAttribute('tabindex', '0')

    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onRowClick).toHaveBeenCalledWith({ id: 'item-1', name: 'Test Item' })
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
          rowBehaviour={{
            getRowHref: (row) => `/items/${row.id}`,
            getRowAccessibleName: (row) => `Open ${row.name}`,
            onRowClick: vi.fn(),
          }}
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
          rowBehaviour={{
            getRowHref: (row) => `/items/${row.id}`,
            getRowAccessibleName: (row) => `Open ${row.name}`,
            onRowClick,
          }}
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
          rowBehaviour={{
            getRowHref: (row) => `/items/${row.id}`,
            getRowAccessibleName: (row) => `Open ${row.name}`,
            onRowClick,
          }}
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
        rowBehaviour={{ onRowClick }}
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
        rowBehaviour={{ onRowClick }}
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
        rowBehaviour={{ onRowClick }}
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
        rowBehaviour={{ onRowClick }}
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
        rowBehaviour={{
          getRowContextActions: () => [
            {
              label: 'Delete',
              onClick: vi.fn(),
              destructive: true,
            },
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Test Item'))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not open a context menu when getRowContextActions returns no actions', () => {
    render(
      <DataTable
        {...defaultProps}
        rowBehaviour={{ getRowContextActions: () => [] }}
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
        rowBehaviour={{
          getRowContextActions: () => [
            {
              label: 'Delete',
              onClick: onDelete,
              destructive: true,
            },
          ],
        }}
      />,
    )

    fireEvent.contextMenu(screen.getByText('Test Item'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith({ name: 'Test Item' })
  })

  it('moves roving focus with ArrowDown and ArrowUp across rows', () => {
    const customers = [
      { id: 'cust-1', label: 'Row one' },
      { id: 'cust-2', label: 'Row two' },
      { id: 'cust-3', label: 'Row three' },
    ]

    render(
      <DataTable
        {...defaultProps}
        columns={[{ accessorKey: 'label', header: 'Name' }]}
        data={customers}
        rowBehaviour={{ onRowClick: vi.fn() }}
      />,
    )

    const rows = screen.getAllByRole('row').filter((row) => row.getAttribute('data-table-row') === 'true')
    expect(rows[0]).toHaveAttribute('tabindex', '0')
    expect(rows[1]).toHaveAttribute('tabindex', '-1')
    expect(rows[2]).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(rows[1]).toHaveAttribute('tabindex', '0')
    expect(rows[0]).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(rows[1], { key: 'ArrowDown' })
    expect(rows[2]).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(rows[2], { key: 'ArrowDown' })
    expect(rows[2]).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(rows[2], { key: 'ArrowUp' })
    expect(rows[1]).toHaveAttribute('tabindex', '0')
  })

  it('keeps the clickable row focus ring class on activatable rows', () => {
    render(<DataTable {...defaultProps} rowBehaviour={{ onRowClick: vi.fn() }} />)

    const row = screen.getByRole('row', { name: 'Test Item' })
    expect(row.className).toMatch(/focus-visible:ring/)
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
  fireEvent.keyDown(screen.getByRole('button', { name: dt.columns }), { key: 'Enter' })
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
    expect(screen.getByRole('menuitemcheckbox', { name: 'Customer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'warehouse_location' })).not.toBeInTheDocument()
  })

  it('keeps the Columns picker visible at every breakpoint', () => {
    render(<ColumnPickerHarness />)

    const trigger = screen.getByRole('button', { name: dt.columns })
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
    fireEvent.click(screen.getByRole('menuitem', { name: dt.showAll }))
    closeOpenMenu()
    expect(screen.getByRole('columnheader', { name: /Storage Location/ })).toBeInTheDocument()
  })

  it('Reset restores the default column layout', () => {
    render(<ColumnPickerHarness />)

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Customer' }))
    closeOpenMenu()
    expect(screen.queryByRole('columnheader', { name: /Customer/ })).not.toBeInTheDocument()

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: dt.reset }))
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

    fireEvent.keyDown(screen.getByRole('button', { name: columnOptionsLabel('Part') }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: dt.hide }))

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

// Paginates client-side the way a consumer with local rows does, so page size changes the rendered rows.
function PagedPartHarness({
  rows,
  rowCount = 0,
  initialPageSize = 10,
  columns = partColumns,
  ...tableProps
}: {
  rows?: PartRow[]
  rowCount?: number
  initialPageSize?: number
  columns?: ColumnDef<PartRow>[]
  pageSizeOptions?: readonly number[]
  enableCsvExport?: boolean
  csvFileName?: string
}) {
  const allRows: PartRow[] =
    rows ??
    Array.from({ length: rowCount }, (_, index) => ({
      id: `part-${index + 1}`,
      sku: `PART-${index + 1}`,
      warehouse_location: `Bin ${index + 1}`,
      customerName: `Customer ${index + 1}`,
      notes: 'Fast mover',
    }))
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: initialPageSize })
  const start = pagination.pageIndex * pagination.pageSize

  return (
    <>
      <output data-testid="pagination">{JSON.stringify(pagination)}</output>
      <DataTable
        columns={columns}
        data={allRows.slice(start, start + pagination.pageSize)}
        pageCount={Math.ceil(allRows.length / pagination.pageSize)}
        columnFilters={[]}
        setColumnFilters={vi.fn()}
        sorting={[]}
        setSorting={vi.fn()}
        pagination={pagination}
        setPagination={setPagination}
        {...tableProps}
      />
    </>
  )
}

function renderedRowCount() {
  return document.querySelectorAll('[data-table-row]').length
}

function openPageSizeMenu() {
  fireEvent.click(screen.getByRole('combobox', { name: dt.rowsPerPageAria }))
}

function pageSizeOptionLabels() {
  return screen.getAllByRole('option').map((option) => option.textContent)
}

function clickExportCsv() {
  fireEvent.click(screen.getByRole('button', { name: dt.exportCsv }))
}

async function downloadedCsv(): Promise<string> {
  const calls = vi.mocked(triggerBlobDownload).mock.calls
  const blob = calls[calls.length - 1]?.[0]
  if (!blob) throw new Error('No CSV download was triggered')
  return blob.text()
}

describe('DataTable page size selector', () => {
  it('offers 10, 25, 50 and 100 rows per page', () => {
    render(<PagedPartHarness rowCount={120} />)

    openPageSizeMenu()

    expect(pageSizeOptionLabels()).toEqual(['10', '25', '50', '100'])
  })

  it('renders the chosen number of rows and returns to the first page', () => {
    render(<PagedPartHarness rowCount={120} />)
    fireEvent.click(screen.getByRole('button', { name: dt.next }))
    expect(screen.getByTestId('pagination')).toHaveTextContent('"pageIndex":1')

    openPageSizeMenu()
    fireEvent.click(screen.getByRole('option', { name: '50' }))

    expect(renderedRowCount()).toBe(50)
    expect(screen.getByTestId('pagination')).toHaveTextContent('{"pageIndex":0,"pageSize":50}')
  })

  it('keeps a non-standard starting size, such as the audit log default, selectable', () => {
    render(<PagedPartHarness rowCount={120} initialPageSize={20} />)

    expect(screen.getByRole('combobox', { name: dt.rowsPerPageAria })).toHaveTextContent('20')
    openPageSizeMenu()

    expect(pageSizeOptionLabels()).toEqual(['10', '20', '25', '50', '100'])
  })

  it('hides the selector only when pageSizeOptions is empty', () => {
    const { unmount } = render(<PagedPartHarness rowCount={3} />)
    expect(screen.getByRole('combobox', { name: dt.rowsPerPageAria })).toBeInTheDocument()
    unmount()

    render(<PagedPartHarness rowCount={3} pageSizeOptions={[]} />)

    expect(screen.queryByRole('combobox', { name: dt.rowsPerPageAria })).not.toBeInTheDocument()
  })
})

describe('DataTable Export CSV', () => {
  it('exports only the visible columns of the rows currently rendered', async () => {
    render(<PagedPartHarness rowCount={12} />)
    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Warehouse location' }))
    closeOpenMenu()

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual([
      'SKU;Customer;Notes',
      ...Array.from({ length: 10 }, (_, index) => `PART-${index + 1};Customer ${index + 1};Fast mover`),
    ])
  })

  it('neutralises formula-like cells and quotes fields that need it', async () => {
    render(
      <PagedPartHarness
        rows={[
          {
            id: 'row-1',
            sku: '=HYPERLINK("https://example.test")',
            warehouse_location: 'Bin; 2',
            customerName: '+49 Example',
            notes: 'say "hi"',
          },
        ]}
      />,
    )

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')[1]).toBe(
      `"'=HYPERLINK(""https://example.test"")";"Bin; 2";'+49 Example;"say ""hi"""`,
    )
  })

  it('downloads as export.csv unless a file name is given', () => {
    const { unmount } = render(<PagedPartHarness rowCount={1} />)
    clickExportCsv()
    expect(triggerBlobDownload).toHaveBeenLastCalledWith(expect.any(Blob), 'export.csv')
    unmount()

    render(<PagedPartHarness rowCount={1} csvFileName="parts.csv" />)
    clickExportCsv()
    expect(triggerBlobDownload).toHaveBeenLastCalledWith(expect.any(Blob), 'parts.csv')
  })

  it('disables Export CSV when there are no rows to export', () => {
    render(<PagedPartHarness rowCount={0} />)

    expect(screen.getByRole('button', { name: dt.exportCsv })).toBeDisabled()
  })

  it('omits Export CSV for tables that already have a dedicated server export', () => {
    const { unmount } = render(<PagedPartHarness rowCount={1} />)
    expect(screen.getByRole('button', { name: dt.exportCsv })).toBeInTheDocument()
    unmount()

    render(<PagedPartHarness rowCount={1} enableCsvExport={false} />)

    expect(screen.queryByRole('button', { name: dt.exportCsv })).not.toBeInTheDocument()
  })

  it('disables Export CSV when every data column is hidden', () => {
    render(<PagedPartHarness rowCount={1} />)
    openColumnsMenu()
    for (const item of screen.getAllByRole('menuitemcheckbox')) {
      fireEvent.click(item)
    }
    closeOpenMenu()

    expect(screen.getByRole('button', { name: dt.exportCsv })).toBeDisabled()
  })

  it('exports the column titles shown in the headers', async () => {
    const orderColumns: ColumnDef<OrderRow>[] = [
      { accessorKey: 'orderNumber', header: ({ column }) => <DataTableColumnHeader column={column} title="Order #" /> },
      { accessorKey: 'createdAt', header: ({ column }) => <DataTableColumnHeader column={column} title="Date" /> },
    ]
    render(<OrderTable columns={orderColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1', createdAt: '2026-10-05' }]} />)

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')[0]).toBe('Order #;Date')
  })

  it('exports the text each cell displays, not the raw object behind it', async () => {
    const customerLabel = (customer: CustomerValue) =>
      customer.type === 'COMPANY' ? customer.company_name ?? '' : `${customer.first_name} ${customer.last_name}`
    const customerColumns: ColumnDef<OrderRow>[] = [
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }: { row: { original: OrderRow } }) => customerLabel(row.original.customer!),
      },
    ]
    render(
      <OrderTable
        columns={customerColumns}
        rows={[
          { id: 'order-1', customer: { type: 'COMPANY', first_name: '', last_name: '', company_name: 'Example GmbH' } },
          { id: 'order-2', customer: { type: 'PERSON', first_name: 'Erika', last_name: 'Example', company_name: null } },
        ]}
      />,
    )

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual(['Customer', 'Example GmbH', 'Erika Example'])
  })

  it('separates adjacent elements in a cell', async () => {
    const tagColumns: ColumnDef<OrderRow>[] = [
      {
        accessorKey: 'orderNumber',
        header: 'Tags',
        cell: () => (
          <>
            <span>Alpha</span>
            <span>Beta</span>
          </>
        ),
      },
    ]
    render(<OrderTable columns={tagColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1' }]} />)

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual(['Tags', 'Alpha Beta'])
  })

  it('disables Export CSV when only structural icon columns remain visible', () => {
    const iconColumns: ColumnDef<OrderRow>[] = [
      { accessorKey: 'orderNumber', header: 'Order' },
      { id: 'icon', header: '', enableHiding: false, cell: () => <svg aria-hidden="true" /> },
    ]
    render(<OrderTable columns={iconColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1' }]} />)
    expect(screen.getByRole('button', { name: dt.exportCsv })).toBeEnabled()

    openColumnsMenu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Order' }))
    closeOpenMenu()

    expect(screen.getByRole('button', { name: dt.exportCsv })).toBeDisabled()
  })

  it('exports the value of a text-like form field that is the only carrier of the cell value', async () => {
    const minutesColumns: ColumnDef<OrderRow>[] = [
      {
        accessorKey: 'orderNumber',
        header: 'Minutes',
        cell: () => <input type="number" inputMode="numeric" defaultValue="12000" readOnly />,
      },
    ]
    render(<OrderTable columns={minutesColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1' }]} />)

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual(['Minutes', '12000'])
  })

  it('exports data columns declared only by id, and leaves out action and icon columns', async () => {
    const mixedColumns: ColumnDef<OrderRow>[] = [
      {
        accessorKey: 'orderNumber',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Order #" />,
      },
      { id: 'period', header: 'Period', cell: () => <span>2026-Q1</span> },
      { id: 'actions', header: '', cell: () => <button type="button">Download</button> },
      { id: 'icon', header: '', cell: () => <svg aria-hidden="true" /> },
    ]
    render(<OrderTable columns={mixedColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1' }]} />)

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual(['Order #;Period', 'SO-1;2026-Q1'])
  })

  it('exports the text of a button that is the only carrier of the cell value', async () => {
    const activeColumns: ColumnDef<OrderRow>[] = [
      {
        accessorKey: 'orderNumber',
        header: 'Active',
        cell: () => (
          <button type="button">
            <span>Example</span>
          </button>
        ),
      },
    ]
    render(<OrderTable columns={activeColumns} rows={[{ id: 'order-1', orderNumber: 'SO-1' }]} />)

    clickExportCsv()

    expect((await downloadedCsv()).split('\r\n')).toEqual(['Active', 'Example'])
  })
})

type CustomerValue = {
  type: 'PERSON' | 'COMPANY'
  first_name: string
  last_name: string
  company_name: string | null
}

type OrderRow = {
  id: string
  orderNumber?: string
  createdAt?: string
  customer?: CustomerValue
}

function OrderTable({ columns, rows }: { columns: ColumnDef<OrderRow>[]; rows: OrderRow[] }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  return (
    <DataTable
      columns={columns}
      data={rows}
      columnFilters={[]}
      setColumnFilters={vi.fn()}
      sorting={[]}
      setSorting={vi.fn()}
      pagination={pagination}
      setPagination={setPagination}
    />
  )
}
