import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type OnChangeFn,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
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
import { DataTableToolbar } from "./data-table-toolbar"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  pageCount?: number
  isLoading?: boolean
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
  getRowContextActions?: (
    row: TData
  ) => Array<{
    label: string
    onClick: (row: TData) => void
    destructive?: boolean
  }>
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageCount = -1,
  isLoading = false,
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
}: DataTableProps<TData, TValue>) {
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
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row.original)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openRowContextMenu(row.original, event.clientX, event.clientY)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
                      return
                    }
                    const rect = event.currentTarget.getBoundingClientRect()
                    event.preventDefault()
                    openRowContextMenu(row.original, rect.left + 12, rect.top + rect.height / 2)
                  }}
                  tabIndex={getRowContextActions?.(row.original)?.length ? 0 : undefined}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextMenu(null)
          }}
        >
          <div
            className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 shadow-md"
            style={{
              top: menuPosition?.top ?? contextMenu.y,
              left: menuPosition?.left ?? contextMenu.x,
            }}
            onClick={(event) => event.stopPropagation()}
            ref={menuRef}
          >
            {getRowContextActions?.(contextMenu.row).map((action) => (
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
        </div>
      )}
    </div>
  )
}
