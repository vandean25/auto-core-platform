import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { Input } from '@/components/ui/input'

type DataTableToolbarSearchProps<TData extends object> = {
  table: Table<TData>
  searchColumn?: string
  placeholder: string
}

export function DataTableToolbarSearch<TData extends object>({
  table,
  searchColumn,
  placeholder,
}: DataTableToolbarSearchProps<TData>) {
  if (searchColumn) {
    return (
      <Input
        placeholder={placeholder}
        value={(table.getColumn(searchColumn)?.getFilterValue() as string) ?? ''}
        onChange={(event) => table.getColumn(searchColumn)?.setFilterValue(event.target.value)}
        className="h-11 md:h-8 md:w-[150px] lg:w-[250px]"
      />
    )
  }

  return (
    <Input
      placeholder={placeholder}
      value={(table.getState().globalFilter as string) ?? ''}
      onChange={(event) => table.setGlobalFilter(event.target.value)}
      className="h-11 md:h-8 md:w-[150px] lg:w-[250px]"
    />
  )
}
