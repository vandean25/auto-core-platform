import type { Table } from "@tanstack/react-table"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddToDashboardButton } from "@/features/dashboard-widgets/AddToDashboardButton"
import { SaveCurrentViewButton } from "@/features/saved-views/SaveCurrentViewButton"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { DataTableViewOptions } from "./data-table-view-options"

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchColumn?: string
  placeholder?: string
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
}

export function DataTableToolbar<TData>({
  table,
  searchColumn,
  placeholder = "Filter...",
  saveViewTitle,
  dashboardSource,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0 || !!table.getState().globalFilter

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        {searchColumn ? (
            <Input
            placeholder={placeholder}
            value={(table.getColumn(searchColumn)?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
                table.getColumn(searchColumn)?.setFilterValue(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
            />
        ) : (
            <Input
            placeholder={placeholder}
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) =>
                table.setGlobalFilter(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
            />
        )}
        
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters()
              table.setGlobalFilter("")
            }}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {saveViewTitle ? <SaveCurrentViewButton title={saveViewTitle} /> : null}
        {dashboardSource ? <AddToDashboardButton source={dashboardSource} /> : null}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
