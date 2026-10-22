import type { ReactNode } from 'react'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { SearchX } from 'lucide-react'

import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { TableCell, TableRow } from '@/components/ui/table'

export type DataTableEmptyState = { message: string; action?: ReactNode }

interface DataTableEmptyRowProps {
  colSpan: number
  fallbackMessage: string
  /** Shown only while no search or filter is active; a filtered-empty table says there are no results. */
  emptyState?: DataTableEmptyState
  columnFilters: ColumnFiltersState
  globalFilter?: string
}

export function DataTableEmptyRow({ colSpan, fallbackMessage, emptyState, columnFilters, globalFilter }: DataTableEmptyRowProps) {
  const isFiltered = columnFilters.length > 0 || Boolean(globalFilter)
  const shown = isFiltered ? undefined : emptyState

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <Empty className="border-0 py-10 md:py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{shown?.message ?? fallbackMessage}</EmptyTitle>
          </EmptyHeader>
          {shown?.action ? <EmptyContent>{shown.action}</EmptyContent> : null}
        </Empty>
      </TableCell>
    </TableRow>
  )
}
