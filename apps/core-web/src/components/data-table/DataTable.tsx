import {
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
import { useEffect, useRef, useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { DataTableToolbar } from "./data-table-toolbar"

type DataTableRowContextAction<TData extends object> = {
  label: string
  onClick: (row: TData) => void
  destructive?: boolean
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, [role="button"]'))
}

function activateRow<TData extends object>(
  event: React.MouseEvent | React.KeyboardEvent,
  row: TData,
  onRowClick?: (row: TData) => void,
) {
  if (!onRowClick || isInteractiveTarget(event.target)) {
    return
  }

  onRowClick(row)
}

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
  onRowClick?: (row: TData) => void
  getRowContextActions?: (row: TData) => DataTableRowContextAction<TData>[]
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
  onRowClick,
  getRowContextActions,
}: DataTableProps<TData>) {
  const [contextMenu, setContextMenu] = useState<{
    row: TData
    x: number
    y: number
  } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const openRowContextMenu = (row: TData, x: number, y: number) => {
    const actions = getRowContextActions?.(row)
    if (!actions || actions.length === 0) return false

    setContextMenu({ row, x, y })
    setMenuPosition({ top: y, left: x })
    return true
  }

  useEffect(() => {
    if (!contextMenu) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu || !menuRef.current) return

    const menuWidth = menuRef.current.offsetWidth
    const menuHeight = menuRef.current.offsetHeight
    const maxLeft = Math.max(0, window.innerWidth - menuWidth)
    const maxTop = Math.max(0, window.innerHeight - menuHeight)
    const clampedLeft = Math.max(0, Math.min(contextMenu.x, maxLeft))
    const clampedTop = Math.max(0, Math.min(contextMenu.y, maxTop))

    setMenuPosition({ top: clampedTop, left: clampedLeft })
  }, [contextMenu])

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      columnFilters,
      sorting,
      pagination,
      globalFilter,
    },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  return (
    <div className="space-y-4">
      <DataTableToolbar 
        table={table} 
        searchColumn={searchColumn} 
        placeholder={searchPlaceholder} 
        saveViewTitle={saveViewTitle}
        dashboardSource={dashboardSource}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
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
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-table-row="true"
                  data-state={row.getIsSelected() && "selected"}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openRowContextMenu(row.original as TData, event.clientX, event.clientY)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      const rect = event.currentTarget.getBoundingClientRect()
                      event.preventDefault()
                      openRowContextMenu(row.original as TData, rect.left + 12, rect.top + rect.height / 2)
                      return
                    }

                    if (event.key !== "Enter" && event.key !== " ") {
                      return
                    }

                    event.preventDefault()
                    activateRow(event, row.original as TData, onRowClick)
                  }}
                  tabIndex={onRowClick || getRowContextActions?.(row.original as TData)?.length ? 0 : undefined}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={onRowClick ? "cursor-pointer" : undefined}
                      onClick={(event) => activateRow(event, row.original as TData, onRowClick)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
        >
            Previous
        </Button>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>Page</span>
            <span className="font-medium">{table.getState().pagination.pageIndex + 1}</span>
            <span>of</span>
            <span className="font-medium">{table.getPageCount()}</span>
        </div>
        <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
        >
            Next
        </Button>
      </div>

      {contextMenu && (
        <>
          <button
            type="button"
            aria-label="Close context menu"
            className="fixed inset-0 z-50 cursor-default"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 shadow-md"
            style={{
              top: menuPosition?.top ?? contextMenu.y,
              left: menuPosition?.left ?? contextMenu.x,
            }}
            ref={menuRef}
          >
            {getRowContextActions?.(contextMenu.row).map((action: DataTableRowContextAction<TData>) => (
              <button
                key={action.label}
                type="button"
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  action.destructive ? "text-destructive" : "text-foreground"
                }`}
                onClick={() => {
                  action.onClick(contextMenu.row)
                  setContextMenu(null)
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
