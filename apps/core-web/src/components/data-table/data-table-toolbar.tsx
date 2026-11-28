import { flexRender } from '@tanstack/react-table'
import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { Download, Loader2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AddToDashboardButton } from "@/features/dashboard-widgets/AddToDashboardButton"
import { SaveCurrentViewButton } from "@/features/saved-views/SaveCurrentViewButton"
import { SavedViewsMenu } from "@/features/saved-views/SavedViewsMenu"
import type { DashboardWidgetTableSource } from "@/features/dashboard-widgets/types"
import { downloadCsv } from "@/lib/csv"
import { formatNumber } from "@/lib/format"
import { INFINITE_LIST_ROW_CAP } from "@/lib/infinite-list-query"
import { DataTableViewOptions } from "./data-table-view-options"
import { DataTableColumnFilters } from "./data-table-column-filters"
import {
  buildDataTableCsv,
  buildDataTableCsvFromDom,
  fetchRemainingInfinitePages,
  getDataTableCsvFileName,
  getDataTableExportColumns,
  isInfiniteCsvCapped,
} from "./data-table-csv"
import { DataTableToolbarSearch } from './data-table-toolbar-search'
import type { DataTableInfiniteView } from './use-data-table-infinite'

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
  infiniteView?: DataTableInfiniteView
  refreshIndicator?: React.ReactNode
}

type CsvButtonProps<TData extends object> = Pick<
  DataTableToolbarProps<TData>,
  'table' | 'csvFileName' | 'saveViewTitle' | 'enableMobileCsvExport' | 'getRoot' | 'isLoading' | 'infiniteView'
>

function HiddenCsvExportTable<TData extends object>({
  table,
  tableRef,
}: {
  table: Table<TData>
  tableRef: React.RefObject<HTMLTableElement | null>
}) {
  const columns = getDataTableExportColumns(table)
  const columnIds = new Set(columns.map((column) => column.id))
  const rows = table.getRowModel().rows.slice(0, INFINITE_LIST_ROW_CAP)

  return (
    <table ref={tableRef} className="sr-only" aria-hidden="true">
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-table-row="true">
            {row
              .getVisibleCells()
              .filter((cell) => columnIds.has(cell.column.id))
              .map((cell) => (
                <td key={cell.id} data-column-id={cell.column.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type ExportRenderState = { capped: boolean; minRows: number } | null

function canUseSyncDomCsvExport(
  infiniteView: DataTableInfiniteView | undefined,
  enableMobileCsvExport: boolean | undefined,
  root: Element | null,
  modelRowCount: number,
): boolean {
  if (infiniteView || enableMobileCsvExport || !root) return false
  return root.querySelectorAll('tbody tr[data-table-row]').length === modelRowCount
}

function flushHiddenCsvExport<TData extends object>({
  table,
  exportTable,
  capped,
  csvFileName,
  saveViewTitle,
  capNotice,
}: {
  table: Table<TData>
  exportTable: HTMLTableElement
  capped: boolean
  csvFileName: string | undefined
  saveViewTitle: string | undefined
  capNotice: string
}) {
  const columns = getDataTableExportColumns(table)
  const renderedRows = Array.from(exportTable.querySelectorAll('tbody tr[data-table-row]'))
  const csv = buildDataTableCsvFromDom(columns, renderedRows, capped ? capNotice : undefined)
  if (csv) downloadCsv(csv, getDataTableCsvFileName(csvFileName, saveViewTitle))
  if (capped) toast.warning(capNotice)
}

async function fetchAndTriggerCsvExport<TData extends object>({
  table,
  infiniteView,
  exportSessionRef,
  setIsExporting,
  setExportRender,
  failedMessage,
}: {
  table: Table<TData>
  infiniteView: DataTableInfiniteView
  exportSessionRef: React.MutableRefObject<number>
  setIsExporting: (value: boolean) => void
  setExportRender: (value: ExportRenderState) => void
  failedMessage: string
}) {
  const modelRows = table.getRowModel().rows
  const session = ++exportSessionRef.current
  setIsExporting(true)
  try {
    const outcome = await fetchRemainingInfinitePages(
      infiniteView,
      modelRows.length,
      () => exportSessionRef.current !== session,
    )
    if (exportSessionRef.current !== session) return
    if (outcome.status === 'error') {
      toast.error(failedMessage)
      return
    }
    if (outcome.status === 'done') setExportRender({ capped: outcome.capped, minRows: outcome.minRows })
  } catch {
    if (exportSessionRef.current === session) toast.error(failedMessage)
  } finally {
    if (exportSessionRef.current === session) setIsExporting(false)
  }
}

function startCsvExport<TData extends object>({
  table,
  root,
  enableMobileCsvExport,
  csvFileName,
  saveViewTitle,
  infiniteView,
  exportSessionRef,
  setIsExporting,
  setExportRender,
  failedMessage,
}: {
  table: Table<TData>
  root: Element | null
  enableMobileCsvExport: boolean | undefined
  csvFileName: string | undefined
  saveViewTitle: string | undefined
  infiniteView: DataTableInfiniteView | undefined
  exportSessionRef: React.MutableRefObject<number>
  setIsExporting: (value: boolean) => void
  setExportRender: (value: ExportRenderState) => void
  failedMessage: string
}) {
  const rowCount = table.getRowModel().rows.length
  if (canUseSyncDomCsvExport(infiniteView, enableMobileCsvExport, root, rowCount)) {
    const csv = buildDataTableCsv(table, root)
    if (csv) downloadCsv(csv, getDataTableCsvFileName(csvFileName, saveViewTitle))
    return
  }
  if (infiniteView && infiniteView.hasNextPage && rowCount < INFINITE_LIST_ROW_CAP) {
    void fetchAndTriggerCsvExport({
      table,
      infiniteView,
      exportSessionRef,
      setIsExporting,
      setExportRender,
      failedMessage,
    })
    return
  }
  const capped = infiniteView ? isInfiniteCsvCapped(infiniteView, rowCount) : false
  setExportRender({ capped, minRows: Math.min(rowCount, INFINITE_LIST_ROW_CAP) })
}

function useCsvExportState<TData extends object>({
  table,
  csvFileName,
  saveViewTitle,
  infiniteView,
}: Pick<CsvButtonProps<TData>, 'table' | 'csvFileName' | 'saveViewTitle' | 'infiniteView'>) {
  const { t } = useTranslation('common')
  const [isExporting, setIsExporting] = useState(false)
  const [exportRender, setExportRender] = useState<ExportRenderState>(null)
  const exportTableRef = useRef<HTMLTableElement | null>(null)
  const exportSessionRef = useRef(0)

  const restoreKey = infiniteView?.restoreKey
  useEffect(() => {
    exportSessionRef.current += 1
    setIsExporting(false)
    setExportRender(null)
  }, [restoreKey])

  const rowCount = table.getRowModel().rows.length
  const maxLabel = formatNumber(INFINITE_LIST_ROW_CAP)
  const capNotice = t('dataTable.exportCsvCapped', { max: maxLabel })

  useLayoutEffect(() => {
    const exportTable = exportTableRef.current
    if (!exportRender || !exportTable || rowCount < exportRender.minRows) return
    flushHiddenCsvExport({ table, exportTable, capped: exportRender.capped, csvFileName, saveViewTitle, capNotice })
    setExportRender(null)
  }, [exportRender, rowCount, table, csvFileName, saveViewTitle, capNotice])

  return {
    isExporting,
    setIsExporting,
    exportRender,
    setExportRender,
    exportTableRef,
    exportSessionRef,
    rowCount,
    maxLabel,
  }
}

function DataTableCsvButton<TData extends object>({
  table, csvFileName, saveViewTitle, enableMobileCsvExport, getRoot, isLoading, infiniteView,
}: CsvButtonProps<TData>) {
  const { t } = useTranslation('common')
  const {
    isExporting,
    setIsExporting,
    exportRender,
    setExportRender,
    exportTableRef,
    exportSessionRef,
    rowCount,
    maxLabel,
  } = useCsvExportState({ table, csvFileName, saveViewTitle, infiniteView })

  const hasColumns = getDataTableExportColumns(table).length > 0
  const disabled = Boolean(isLoading || isExporting || rowCount === 0 || !hasColumns)
  const title = infiniteView ? t('dataTable.exportCsvTitleInfinite', { max: maxLabel }) : t('dataTable.exportCsvTitle')
  const Icon = isExporting ? Loader2 : Download

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={enableMobileCsvExport ? "h-11 md:h-8" : "h-8 max-md:hidden"}
        title={title}
        disabled={disabled}
        onClick={() =>
          startCsvExport({
            table,
            root: getRoot?.() ?? null,
            enableMobileCsvExport,
            csvFileName,
            saveViewTitle,
            infiniteView,
            exportSessionRef,
            setIsExporting,
            setExportRender,
            failedMessage: t('dataTable.exportCsvFailed'),
          })
        }
      >
        <Icon className={isExporting ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
        {isExporting ? t('dataTable.exportingCsv') : t('dataTable.exportCsv')}
      </Button>
      {exportRender ? <HiddenCsvExportTable table={table} tableRef={exportTableRef} /> : null}
    </>
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
  infiniteView,
  refreshIndicator,
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation('common')
  const filterPlaceholder = placeholder ?? t('dataTable.filterPlaceholder')

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="data-table-toolbar">
      {/* Full width below md (phones and 200% zoom), so the search hint is not cut off by the buttons next to it. */}
      <div className="flex flex-1 flex-wrap items-center gap-2 max-md:basis-full">
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
            infiniteView={infiniteView}
          />
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
