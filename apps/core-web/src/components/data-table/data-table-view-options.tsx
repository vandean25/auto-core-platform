import { DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu"
import { Settings2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { getDataTableColumnLabel } from "./data-table-column-label"
import { DataTableDensityMenuItem } from "./data-table-density-toggle"

interface DataTableViewOptionsProps<TData extends object> {
  table: Table<TData>
}

// Mounted only while the menu is open, so labels are read after the column headers have committed their titles.
function ColumnToggleItems<TData extends object>({ table }: DataTableViewOptionsProps<TData>) {
  return table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanHide()
    )
    .map((column) => {
      return (
        <DropdownMenuCheckboxItem
          key={column.id}
          checked={column.getIsVisible()}
          onCheckedChange={(value: boolean) => column.toggleVisibility(!!value)}
          onSelect={(event) => event.preventDefault()}
        >
          {getDataTableColumnLabel(column)}
        </DropdownMenuCheckboxItem>
      )
    })
}

export function DataTableViewOptions<TData extends object>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const { t } = useTranslation('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 max-md:hidden"
        >
          <Settings2 className="mr-2 h-4 w-4" />
          {t('dataTable.columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuLabel>{t('dataTable.toggleColumns')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            table.toggleAllColumnsVisible(true)
          }}
        >
          {t('dataTable.showAll')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            table.resetColumnVisibility()
          }}
        >
          {t('dataTable.reset')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ColumnToggleItems table={table} />
        <DropdownMenuSeparator />
        <DataTableDensityMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
