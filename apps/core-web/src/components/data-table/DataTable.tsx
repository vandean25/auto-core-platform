import {
  type LegacyColumn,
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  useLegacyTable as useReactTable,
} from '@tanstack/react-table/legacy'
import {
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type OnChangeFn,
  flexRender,
} from '@tanstack/react-table'
import {
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { useTranslation } from "react-i18next"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { TableSkeleton } from "@/components/ui/skeleton-presets"
import { cn } from "@/lib/utils"
import { getDataTableCellClassName, getDataTableHeadClassName } from "./data-table-column-meta"
import { DataTableDensityContext, type DataTableDensity } from "./data-table-density-toggle"
import { useDataTableContextMenu, type DataTableRowContextAction } from "./data-table-context-menu"
import { DataTableSelectionBar, useDataTableSelection } from "./data-table-selection"
import { DataTableEmptyRow, type DataTableEmptyState } from "./data-table-states"
import { DataTableToolbar } from "./data-table-toolbar"
import { DataTableRowDetailLink, isDataTableRowLinkColumn } from "./data-table-row-link"

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  return Boolean(
    target.closest('button, a, input, select, textarea, [role="button"]'),
  )
}

function getTableRowId(record: object): string | undefined {
  const id = (record as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

// Only header render functions (the DataTableColumnHeader pattern) expose a sort control.
// Plain-text headers do not, so they must not advertise sorting.
function getAriaSort<TData extends object>(column: LegacyColumn<TData, unknown>) {
  if (typeof column.columnDef.header !== "function" || !column.getCanSort()) return undefined

  const sorted = column.getIsSorted()
  if (sorted === "asc") return "ascending" as const
  if (sorted === "desc") return "descending" as const
  return "none" as const
}

function resolveRowFromElement<TData extends object>(
  element: HTMLTableRowElement,
  data: TData[],
  fallback: TData,
): TData {
  const rowId = element.getAttribute('data-row-id')
  if (!rowId) return fallback

  const match = data.find((record) => getTableRowId(record) === rowId)
  return match ?? fallback
}

function activateRow<TData extends object>(
  event: ReactMouseEvent | ReactKeyboardEvent,
  fallback: TData,
  data: TData[],
  onRowClick?: (row: TData) => void,
) {
  if (!onRowClick || isInteractiveTarget(event.target)) {
    return
  }

  const rowElement = (event.currentTarget as HTMLElement).closest('tr')
  if (!(rowElement instanceof HTMLTableRowElement)) {
    return
  }

  onRowClick(resolveRowFromElement(rowElement, data, fallback))
}

const clickableRowClassName =
  'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function handleRowClick<TData extends object>(
  event: React.MouseEvent<HTMLTableRowElement>,
  data: TData[],
  fallback: TData,
  onRowClick?: (row: TData) => void,
) {
  // Cell clicks are handled on <td>; keep <tr> for programmatic row.click() and tests.
  if (event.target !== event.currentTarget) {
    return
  }

  activateRow(event, fallback, data, onRowClick)
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

interface DataTableProps<TData extends object> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageCount?: number
  isLoading?: boolean
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
  columnFilters: ColumnFiltersState
  setColumnFilters: OnChangeFn<ColumnFiltersState>
  globalFilter?: string
  setGlobalFilter?: OnChangeFn<string>
  sorting: SortingState
  setSorting: OnChangeFn<SortingState>
  pagination: PaginationState
  setPagination: OnChangeFn<PaginationState>
  searchColumn?: string
  searchPlaceholder?: string
  emptyStateMessage?: string
  // Replaces the empty message and adds an action (e.g. "New customer") while no search or filter is active.
  emptyState?: DataTableEmptyState
  // Adds a checkbox column. While rows are selected, the returned actions dock in a floating bar.
  bulkActions?: (selectedRows: TData[]) => ReactNode
  onRowClick?: (row: TData) => void
  getRowHref?: (row: TData) => string | undefined
  getRowAccessibleName?: (row: TData) => string
  getRowContextActions?: (row: TData) => DataTableRowContextAction<TData>[]
  // Choices for the "Rows per page" select. An empty array hides it, e.g. for tables that render all their rows.
  pageSizeOptions?: readonly number[]
  enableCsvExport?: boolean
  csvFileName?: string
}

export function DataTable<TData extends object>({
  columns,
  data,
  pageCount = -1,
  isLoading = false,
  saveViewTitle,
  dashboardSource,
  columnFilters,
  setColumnFilters,
  globalFilter,
  setGlobalFilter,
  sorting,
  setSorting,
  pagination,
  setPagination,
  searchColumn,
  searchPlaceholder,
  emptyStateMessage,
  emptyState,
  bulkActions,
  onRowClick,
  getRowHref,
  getRowAccessibleName,
  getRowContextActions,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  enableCsvExport,
  csvFileName,
}: DataTableProps<TData>) {
  const { t } = useTranslation('common')
  const resolvedEmptyStateMessage = emptyStateMessage ?? t('dataTable.noResults')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [density, setDensity] = useState<DataTableDensity>("normal")
  const hasBulkActions = Boolean(bulkActions)
  const { rowSelection, setRowSelection, withSelectColumn, withSelectionReset } = useDataTableSelection<TData>(hasBulkActions)

  const { openRowContextMenu, menu: contextMenu } = useDataTableContextMenu(getRowContextActions)

  const table = useReactTable({
    data,
    columns: withSelectColumn(columns),
    pageCount,
    getRowId: (row, index) => getTableRowId(row) ?? String(index),
    state: {
      columnFilters,
      sorting,
      pagination,
      globalFilter,
      rowSelection,
    },
    enableRowSelection: hasBulkActions,
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: withSelectionReset(setPagination),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  const pageSizeChoices =
    pageSizeOptions.length > 0
      ? [...new Set([...pageSizeOptions, pagination.pageSize])].sort((a, b) => a - b)
      : []

  const visibleColumnCount = table.getVisibleLeafColumns().length

  return (
    <div className="space-y-4" ref={rootRef}>
      <DataTableDensityContext.Provider value={{ density, setDensity }}>
        <DataTableToolbar 
          table={table} 
          searchColumn={searchColumn} 
          placeholder={searchPlaceholder} 
          saveViewTitle={saveViewTitle}
          dashboardSource={dashboardSource}
          enableCsvExport={enableCsvExport}
          csvFileName={csvFileName}
          getRoot={() => rootRef.current}
          isLoading={isLoading}
        />
      </DataTableDensityContext.Provider>
      {/* 70vh: the table scrolls inside its own box, which keeps the sticky header in view. */}
      <div
        className={cn(
          "max-w-full overflow-x-auto rounded-md border [&>div]:max-h-[70vh]",
          "data-[density=compact]:[&_td]:py-1.5 data-[density=compact]:[&_th]:h-9",
        )}
        data-density={density}
      >
        <Table aria-busy={isLoading}>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} data-table-header="true">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={getAriaSort(header.column)}
                      className={getDataTableHeadClassName(header.column.columnDef)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={Math.min(pagination.pageSize, 8)} cols={visibleColumnCount} />
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowData = row.original as TData
                const rowId = getTableRowId(rowData)
                const rowHref = getRowHref?.(rowData)
                const rowAccessibleName = getRowAccessibleName?.(rowData)
                const rowUsesDetailLink = Boolean(
                  rowHref &&
                    rowAccessibleName &&
                    row
                      .getVisibleCells()
                      .some((cell) => isDataTableRowLinkColumn(cell.column.columnDef)),
                )
                const rowIsKeyboardActivatable = Boolean(
                  (onRowClick && !rowUsesDetailLink) || getRowContextActions?.(rowData)?.length,
                )

                return (
                <TableRow
                  key={row.id}
                  data-table-row="true"
                  data-row-id={rowId}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={(event) => handleRowClick(event, data, rowData, onRowClick)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openRowContextMenu(
                      resolveRowFromElement(event.currentTarget, data, rowData),
                      event.clientX,
                      event.clientY,
                    )
                  }}
                  onKeyDown={(event) => {
                    const resolvedRow = resolveRowFromElement(event.currentTarget, data, rowData)

                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      const rect = event.currentTarget.getBoundingClientRect()
                      event.preventDefault()
                      openRowContextMenu(resolvedRow, rect.left + 12, rect.top + rect.height / 2)
                      return
                    }

                    if (rowUsesDetailLink) {
                      return
                    }

                    if (event.key !== "Enter" && event.key !== " ") {
                      return
                    }

                    if (!onRowClick || isInteractiveTarget(event.target)) {
                      return
                    }

                    event.preventDefault()
                    activateRow(event, resolvedRow, data, onRowClick)
                  }}
                  tabIndex={rowIsKeyboardActivatable ? 0 : undefined}
                  className={onRowClick ? clickableRowClassName : ""}
                >
                  {row.getVisibleCells().map((cell) => {
                    const cellContent = flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )
                    const shouldRenderRowLink =
                      rowUsesDetailLink &&
                      isDataTableRowLinkColumn(cell.column.columnDef)

                    return (
                    <TableCell
                      key={cell.id}
                      data-column-id={cell.column.id}
                      className={getDataTableCellClassName(cell.column.columnDef, Boolean(onRowClick))}
                      onClick={
                        onRowClick
                          ? (event) => activateRow(event, rowData, data, onRowClick)
                          : undefined
                      }
                    >
                      {shouldRenderRowLink && rowHref && rowAccessibleName ? (
                        <DataTableRowDetailLink
                          href={rowHref}
                          accessibleName={rowAccessibleName}
                        >
                          {cellContent}
                        </DataTableRowDetailLink>
                      ) : (
                        cellContent
                      )}
                    </TableCell>
                    )
                  })}
                </TableRow>
                )
              })
            ) : (
              <DataTableEmptyRow
                colSpan={visibleColumnCount}
                fallbackMessage={resolvedEmptyStateMessage}
                emptyState={emptyState}
                columnFilters={columnFilters}
                globalFilter={globalFilter}
              />
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-4">
        {pageSizeChoices.length > 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t('dataTable.rowsPerPage')}</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) => setPagination({ pageIndex: 0, pageSize: Number(value) })}
            >
              <SelectTrigger aria-label={t('dataTable.rowsPerPageAria')} className="h-8 w-[76px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeChoices.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-center justify-end space-x-2">
          <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
          >
              {t('dataTable.previous')}
          </Button>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>{t('dataTable.page')}</span>
              <span className="font-medium">{table.getState().pagination.pageIndex + 1}</span>
              <span>{t('dataTable.of')}</span>
              <span className="font-medium">{table.getPageCount()}</span>
          </div>
          <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
          >
              {t('dataTable.next')}
          </Button>
        </div>
      </div>

      <DataTableSelectionBar table={table} bulkActions={bulkActions} />

      {contextMenu}
    </div>
  )
}
