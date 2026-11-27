import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { Download, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { AddToDashboardButton } from "@/features/dashboard-widgets/AddToDashboardButton"
import { SaveCurrentViewButton } from "@/features/saved-views/SaveCurrentViewButton"
import { SavedViewsMenu } from "@/features/saved-views/SavedViewsMenu"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { downloadCsv } from "@/lib/csv"
import { DataTableViewOptions } from "./data-table-view-options"
import { DataTableColumnFilters } from "./data-table-column-filters"
import { buildDataTableCsv, getDataTableCsvFileName, getDataTableExportColumns } from "./data-table-csv"
import { DataTableToolbarSearch } from './data-table-toolbar-search'

interface DataTableToolbarProps<TData extends object> {
  table: Table<TData>
  searchColumn?: string
  placeholder?: string
  saveViewTitle?: string
  getLayoutHref?: () => string
  dashboardSource?: DashboardWidgetTableSource
  enableCsvExport?: boolean
  csvFileName?: string
  enableMobileCsvExport?: boolean
  toolbarFilters?: React.ReactNode
  getRoot?: () => Element | null
  isLoading?: boolean
  refreshIndicator?: React.ReactNode
}

type CsvButtonProps<TData extends object> = Pick<
  DataTableToolbarProps<TData>,
  'table' | 'csvFileName' | 'saveViewTitle' | 'enableMobileCsvExport' | 'getRoot' | 'isLoading'
>

function DataTableCsvButton<TData extends object>({
  table, csvFileName, saveViewTitle, enableMobileCsvExport, getRoot, isLoading,
}: CsvButtonProps<TData>) {
  const { t } = useTranslation('common')
  const disabled = isLoading || table.getRowModel().rows.length === 0 || getDataTableExportColumns(table).length === 0

  function exportCsv() {
    const csv = buildDataTableCsv(table, getRoot?.() ?? null, enableMobileCsvExport)
    if (csv) downloadCsv(csv, getDataTableCsvFileName(csvFileName, saveViewTitle))
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={enableMobileCsvExport ? "h-11 md:h-8" : "h-8 max-md:hidden"}
      title={t('dataTable.exportCsvTitle')}
      disabled={disabled}
      onClick={exportCsv}
    >
      <Download className="mr-2 h-4 w-4" />
      {t('dataTable.exportCsv')}
    </Button>
  )
}

function DataTableFilterReset<TData extends object>({ table }: { table: Table<TData> }) {
  const { t } = useTranslation('common')
  const { columnFilters, globalFilter } = table.getState()
  if (columnFilters.length === 0 && !globalFilter) return null

  return (
    <Button
      variant="ghost"
      onClick={() => {
        table.resetColumnFilters()
        table.setGlobalFilter("")
      }}
      className="h-11 px-2 md:h-8 lg:px-3"
    >
      {t('dataTable.reset')}
      <X className="ml-2 h-4 w-4" />
    </Button>
  )
}

export function DataTableToolbar<TData extends object>({
  table,
  searchColumn,
  placeholder,
  saveViewTitle,
  getLayoutHref,
  dashboardSource,
  enableCsvExport = true,
  csvFileName,
  enableMobileCsvExport = false,
  toolbarFilters,
  getRoot,
  isLoading = false,
  refreshIndicator,
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation('common')
  const filterPlaceholder = placeholder ?? t('dataTable.filterPlaceholder')

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="data-table-toolbar">
      {/* Full width on a phone, so the search hint is not cut off by the buttons next to it. */}
      <div className="flex flex-1 flex-wrap items-center gap-2 max-sm:basis-full">
        <DataTableToolbarSearch table={table} searchColumn={searchColumn} placeholder={filterPlaceholder} />
        <DataTableColumnFilters table={table} />
        {toolbarFilters}
        <DataTableFilterReset table={table} />
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="data-table-toolbar-actions">
        {refreshIndicator}
        {saveViewTitle && (
          <>
            <SavedViewsMenu title={saveViewTitle} />
            <SaveCurrentViewButton title={saveViewTitle} getHref={getLayoutHref} />
          </>
        )}
        {dashboardSource && <AddToDashboardButton source={dashboardSource} />}
        {enableCsvExport && (
          <DataTableCsvButton
            table={table}
            csvFileName={csvFileName}
            saveViewTitle={saveViewTitle}
            enableMobileCsvExport={enableMobileCsvExport}
            getRoot={getRoot}
            isLoading={isLoading}
          />
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
