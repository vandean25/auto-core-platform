export type ListScrollAnchor = { rowId: string; offset: number }

const MAX_ANCHORS = 50
const anchors = new Map<string, ListScrollAnchor>()

/** Where an infinite list was scrolled to: the record at the top edge plus the pixels past its start (ADR-0035 §7). */
export function rememberListScrollAnchor(listKey: string, anchor: ListScrollAnchor) {
  anchors.delete(listKey)
  anchors.set(listKey, anchor)
  // shortcut: oldest-first eviction, no persistence across reloads; upgrade if lists must survive a page reload.
  if (anchors.size > MAX_ANCHORS) anchors.delete(anchors.keys().next().value as string)
}

export function readListScrollAnchor(listKey: string): ListScrollAnchor | undefined {
  return anchors.get(listKey)
}

/** A tenant, site or session change discards saved positions together with the cached rows. */
export function clearListScrollAnchors() {
  anchors.clear()
}
