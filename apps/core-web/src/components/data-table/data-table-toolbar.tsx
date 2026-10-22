import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { Download, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddToDashboardButton } from "@/features/dashboard-widgets/AddToDashboardButton"
import { SaveCurrentViewButton } from "@/features/saved-views/SaveCurrentViewButton"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { downloadCsv } from "@/lib/csv"
import { DataTableViewOptions } from "./data-table-view-options"
import { DataTableColumnFilters } from "./data-table-column-filters"
import { DataTableDensityToggle } from "./data-table-density-toggle"
import { buildDataTableCsv, getDataTableCsvFileName, getDataTableExportColumns } from "./data-table-csv"

interface DataTableToolbarProps<TData extends object> {
  table: Table<TData>
  searchColumn?: string
  placeholder?: string
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
  enableCsvExport?: boolean
  csvFileName?: string
  getRoot?: () => Element | null
  isLoading?: boolean
}

export function DataTableToolbar<TData extends object>({
  table,
  searchColumn,
  placeholder,
  saveViewTitle,
  dashboardSource,
  enableCsvExport = true,
  csvFileName,
  getRoot,
  isLoading = false,
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation('common')
  const filterPlaceholder = placeholder ?? t('dataTable.filterPlaceholder')
  const isFiltered = table.getState().columnFilters.length > 0 || !!table.getState().globalFilter

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {searchColumn ? (
            <Input
            placeholder={filterPlaceholder}
            value={(table.getColumn(searchColumn)?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
                table.getColumn(searchColumn)?.setFilterValue(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
            />
        ) : (
            <Input
            placeholder={filterPlaceholder}
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) =>
                table.setGlobalFilter(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
            />
        )}
        <DataTableColumnFilters table={table} />

        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters()
              table.setGlobalFilter("")
            }}
            className="h-8 px-2 lg:px-3"
          >
            {t('dataTable.reset')}
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {saveViewTitle ? <SaveCurrentViewButton title={saveViewTitle} /> : null}
        {dashboardSource ? <AddToDashboardButton source={dashboardSource} /> : null}
        {enableCsvExport ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            title={t('dataTable.exportCsvTitle')}
            disabled={isLoading || table.getRowModel().rows.length === 0 || getDataTableExportColumns(table).length === 0}
            onClick={() => {
              const csv = buildDataTableCsv(table, getRoot?.() ?? null)
              if (csv) downloadCsv(csv, getDataTableCsvFileName(csvFileName, saveViewTitle))
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            {t('dataTable.exportCsv')}
          </Button>
        ) : null}
        <DataTableDensityToggle />
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
