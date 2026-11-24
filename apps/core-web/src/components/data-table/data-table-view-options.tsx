import { DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu"
import { Settings2 } from "lucide-react"
import { useContext } from 'react'
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
import { DataTableDensityContext, DataTableDensityMenuItem } from "./data-table-density-toggle"

interface DataTableViewOptionsProps<TData extends object> {
  table: Table<TData>
}

// Mounted only while the menu is open, so labels are read after the column headers have committed their titles.
function ColumnToggleItems<TData extends object>({ table }: DataTableViewOptionsProps<TData>) {
  const columns = table.getAllFlatColumns().filter((column) => column.accessorFn !== undefined && column.getCanHide())
  return columns.map((column) => (
    <DropdownMenuCheckboxItem
      key={column.id}
      checked={column.getIsVisible()}
      onCheckedChange={(value) => column.toggleVisibility(value)}
      onSelect={(event) => event.preventDefault()}
    >
      {getDataTableColumnLabel(column)}
    </DropdownMenuCheckboxItem>
  ))
}

export function DataTableViewOptions<TData extends object>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const { t } = useTranslation('common')
  const density = useContext(DataTableDensityContext)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-11 max-md:w-11 max-md:px-0 md:ml-auto md:h-8"
          title={t('dataTable.toggleColumns')}
        >
          <Settings2 className="h-4 w-4 md:mr-2" />
          <span className="max-md:sr-only">{t('dataTable.columns')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-(--radix-dropdown-menu-content-available-height) w-[200px] overflow-y-auto max-md:[&_[role^=menuitem]]:min-h-11"
      >
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
            density?.setDensity('comfortable')
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
