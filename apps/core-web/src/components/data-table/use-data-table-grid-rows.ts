import { useVirtualizer } from '@tanstack/react-virtual'
import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { useEffect, useRef, type RefObject } from 'react'

import type { DataTableDensity } from '@/lib/density-tokens'
import type { DataTableBodyRowModel } from './data-table-body-row'
import type { DataTableVirtualRows } from './data-table-grid-body'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import type { DataTableInfiniteView } from './use-data-table-infinite'
import { useDataTableRovingFocus } from './use-data-table-roving-focus'
import { useDataTableRowShortcuts } from './use-data-table-row-shortcuts'
import { useDataTableVirtualEffects, useDataTableVirtualOptions } from './use-data-table-virtual'

// Row and header heights of the two densities (Table cell padding), used until a row has been measured.
const ESTIMATED_ROW_HEIGHT = { comfortable: 49, compact: 37 } as const
const HEADER_HEIGHT = { comfortable: 44, compact: 36 } as const

type Params<TData extends object> = {
  table: LegacyTable<TData>
  rowBehaviour: DataTableRowBehaviour<TData> | undefined
  infiniteView: DataTableInfiniteView | undefined
  density: DataTableDensity
  hideHeader: boolean
  tableRef: RefObject<HTMLTableElement | null>
  tableBodyRef: RefObject<HTMLTableSectionElement | null>
}

/**
 * Roving focus, j/k shortcuts and (in infinite mode) the virtualized render window of the table. The sticky header
 * sits above the rows inside the same scroll box, hence the scroll margin.
 */
export function useDataTableGridRows<TData extends object>({
  table,
  rowBehaviour,
  infiniteView,
  density,
  hideHeader,
  tableRef,
  tableBodyRef,
}: Params<TData>) {
  const scrollToRowRef = useRef<((index: number) => void) | null>(null)
  const bodyRowModels = table.getRowModel().rows.map((row) => row as DataTableBodyRowModel<TData>)
  const rowKeys = bodyRowModels.map((row) => row.id)
  const roving = useDataTableRovingFocus(bodyRowModels, rowBehaviour, tableBodyRef, scrollToRowRef)
  useDataTableRowShortcuts(table, tableBodyRef, roving.hasRovingRows, roving.moveFocusFrom)

  const headerHeight = hideHeader ? 0 : HEADER_HEIGHT[density]
  const pinnedIndex = roving.activeKey === null ? -1 : rowKeys.indexOf(roving.activeKey)
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    ...useDataTableVirtualOptions<HTMLElement>(infiniteView, rowKeys, pinnedIndex),
    getScrollElement: () => tableRef.current?.parentElement ?? null,
    estimateSize: () => ESTIMATED_ROW_HEIGHT[density],
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  })
  useEffect(() => {
    scrollToRowRef.current = (index) => virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [virtualizer])
  useDataTableVirtualEffects(virtualizer, infiniteView, rowKeys, headerHeight)

  const virtual: DataTableVirtualRows | undefined = infiniteView
    ? {
        items: virtualizer.getVirtualItems(),
        startOffset: headerHeight,
        totalSize: virtualizer.getTotalSize(),
        measureElement: virtualizer.measureElement,
      }
    : undefined

  return {
    virtual,
    moveFocusFrom: roving.moveFocusFrom,
    tabIndexForRow: roving.tabIndexForRow,
    onRowFocus: roving.onRowFocus,
  }
}
