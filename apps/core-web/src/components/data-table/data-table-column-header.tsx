import { useLayoutEffect } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, EllipsisVertical, EyeOff } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LegacyColumn as Column } from '@tanstack/react-table/legacy'

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DataTableColumnHeaderProps<TData extends object, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>
  title: string
}

// Title last rendered for each column, so the CSV export and the Columns menu can use the on-screen name.
const columnTitles = new WeakMap<object, string>()

export function getDataTableColumnTitle(column: object): string | undefined {
  return columnTitles.get(column)
}

// One click per step: none -> asc -> desc -> none.
function cycleSorting<TData extends object, TValue>(column: Column<TData, TValue>) {
  const sorted = column.getIsSorted()
  if (sorted === "asc") {
    column.toggleSorting(true)
  } else if (sorted === "desc") {
    column.clearSorting()
  } else {
    column.toggleSorting(false)
  }
}

export function DataTableColumnHeader<TData extends object, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const { t } = useTranslation('common')
  useLayoutEffect(() => {
    columnTitles.set(column, title)
  }, [column, title])

  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>
  }

  const sorted = column.getIsSorted()
  const SortIcon = sorted === "desc" ? ArrowDown : sorted === "asc" ? ArrowUp : ChevronsUpDown

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8"
        onClick={() => cycleSorting(column)}
      >
        <span>{title}</span>
        <SortIcon className="ml-2 h-4 w-4" />
      </Button>
      {column.getCanHide() && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 data-[state=open]:bg-accent"
              aria-label={t('dataTable.columnOptions', { title })}
            >
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOff className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
              {t('dataTable.hide')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
