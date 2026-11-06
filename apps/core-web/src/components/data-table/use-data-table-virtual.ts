import { defaultRangeExtractor, type Range, type Virtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useRef } from 'react'

import { readListScrollAnchor, rememberListScrollAnchor } from '@/lib/list-scroll-anchors'
import type { DataTableInfiniteView } from './use-data-table-infinite'

const OVERSCAN_ROWS = 8

/**
 * Options shared by the table and the card list virtualizer. `pinnedIndex` (the roving-focus row) stays mounted,
 * so keyboard focus and the one tab stop never disappear with the render window. Disabled for offset tables.
 */
export function useDataTableVirtualOptions<TScroll extends Element | Window>(
  view: DataTableInfiniteView | undefined,
  rowKeys: readonly string[],
  pinnedIndex: number,
) {
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (pinnedIndex < 0 || pinnedIndex >= range.count || indexes.includes(pinnedIndex)) return indexes
      return [...indexes, pinnedIndex].sort((a, b) => a - b)
    },
    [pinnedIndex],
  )

  return {
    enabled: view !== undefined,
    count: view ? rowKeys.length : 0,
    overscan: OVERSCAN_ROWS,
    rangeExtractor,
    getItemKey: (index: number) => rowKeys[index] ?? index,
    onChange: (instance: Virtualizer<TScroll, Element>) => {
      if (!view || !instance.isScrolling || instance.scrollOffset === null) return
      const item = instance.getVirtualItemForOffset(instance.scrollOffset)
      const rowId = item ? rowKeys[item.index] : undefined
      if (item && rowId !== undefined) {
        rememberListScrollAnchor(view.restoreKey, { rowId, offset: instance.scrollOffset - item.start })
      }
    },
  }
}

/** Less than one viewport of loaded rows is left below the visible area (also true when the rows do not fill the viewport). */
function isWithinOneViewportOfEnd<TScroll extends Element | Window>(
  virtualizer: Virtualizer<TScroll, Element>,
  scrollMargin: number,
) {
  const viewport = virtualizer.scrollRect?.height ?? 0
  const below = virtualizer.getTotalSize() + scrollMargin - ((virtualizer.scrollOffset ?? 0) + viewport)
  return below <= viewport
}

function canRequestPage(view: DataTableInfiniteView | undefined, rowCount: number): view is DataTableInfiniteView {
  if (!view?.canLoadMore || rowCount === 0) return false
  return !view.isFetchingNextPage && !view.isFetchNextPageError && !view.isRefreshing
}

/**
 * Behaviour on top of a virtualizer: load ahead, restart at the top, restore the position after a detail view.
 * `scrollMargin` is the offset of a window-scrolled list from the top of the page.
 */
export function useDataTableVirtualEffects<TScroll extends Element | Window>(
  virtualizer: Virtualizer<TScroll, Element>,
  view: DataTableInfiniteView | undefined,
  rowKeys: readonly string[],
  scrollMargin = 0,
) {
  const rowCount = rowKeys.length
  const requestedAtCount = useRef<number | null>(null)

  // Load ahead, which also fills a viewport that starts out too short. One request per loaded count,
  // because fetchNextPage cancels a running fetch by default.
  useEffect(() => {
    if (!canRequestPage(view, rowCount) || requestedAtCount.current === rowCount) return
    if (!isWithinOneViewportOfEnd(virtualizer, scrollMargin)) return
    requestedAtCount.current = rowCount
    void view.fetchNextPage()
  })

  // A restart (new filter, sort, search or refresh) begins at page one at the top.
  const epoch = view?.epoch
  const lastEpoch = useRef(epoch)
  useEffect(() => {
    if (lastEpoch.current === epoch) return
    lastEpoch.current = epoch
    requestedAtCount.current = null
    virtualizer.scrollToOffset(0)
  }, [epoch, virtualizer])

  // Back from a detail view with the rows still cached: land on the same record at the same pixel offset.
  // Rows that load after mount mean the cache was gone, so the list starts at the top.
  const hadRowsAtMount = useRef(rowCount > 0)
  const restoreAttempted = useRef(false)
  const restoreKey = view?.restoreKey
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    const anchor = restoreKey === undefined || !hadRowsAtMount.current ? undefined : readListScrollAnchor(restoreKey)
    const index = anchor ? rowKeys.indexOf(anchor.rowId) : -1
    // getOffsetForIndex leaves room for the sticky header above the row; the anchor is relative to the row itself.
    const offset = index < 0 ? undefined : virtualizer.getOffsetForIndex(index, 'start')?.[0]
    if (anchor && offset !== undefined) {
      virtualizer.scrollToOffset(offset + virtualizer.options.scrollPaddingStart + anchor.offset)
    }
  }, [restoreKey, rowKeys, virtualizer])
}
