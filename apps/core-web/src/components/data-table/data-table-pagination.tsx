import { useTranslation } from 'react-i18next'
import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function getPageSizeChoices(
  pageSizeOptions: readonly number[],
  pageSize: number,
): number[] {
  if (pageSizeOptions.length === 0) return []
  return [...new Set([...pageSizeOptions, pageSize])].sort((a, b) => a - b)
}

type DataTablePaginationProps<TData extends object> = {
  table: Table<TData>
  pageSizeOptions: readonly number[]
}

export function DataTablePagination<TData extends object>({
  table,
  pageSizeOptions,
}: DataTablePaginationProps<TData>) {
  const { t } = useTranslation('common')
  const pagination = table.getState().pagination
  const pageSizeChoices = getPageSizeChoices(pageSizeOptions, pagination.pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-4">
      {pageSizeChoices.length > 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t('dataTable.rowsPerPage')}</span>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(value) =>
              table.setPagination({ pageIndex: 0, pageSize: Number(value) })
            }
          >
            <SelectTrigger aria-label={t('dataTable.rowsPerPageAria')} className="h-8 w-[76px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeChoices.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div />
      )}
      <div className="flex items-center justify-end space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          {t('dataTable.previous')}
        </Button>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{t('dataTable.page')}</span>
          <span className="font-medium">{pagination.pageIndex + 1}</span>
          <span>{t('dataTable.of')}</span>
          <span className="font-medium">{table.getPageCount()}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          {t('dataTable.next')}
        </Button>
      </div>
    </div>
  )
}
