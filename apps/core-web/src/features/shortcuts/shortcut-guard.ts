const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]'
const DATA_TABLE_ROW_SELECTOR = 'tr[data-table-row="true"]'

export function hasShortcutModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

export function isShortcutLayerSuspended(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  return document.querySelector(OVERLAY_SELECTOR) !== null
}

export function getFocusedDataTableRowId(): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const active = document.activeElement
  if (!active) {
    return null
  }
  const row = active.closest(DATA_TABLE_ROW_SELECTOR)
  if (!row) {
    return null
  }
  return row.getAttribute('data-row-id')
}

export function isFocusOnDataTableRow(): boolean {
  return getFocusedDataTableRowId() !== null
}

export function isRowShortcutEnabled(event: KeyboardEvent): boolean {
  return (
    !isShortcutLayerSuspended() &&
    isFocusOnDataTableRow() &&
    !hasShortcutModifier(event)
  )
}

export function isGlobalShortcutEnabled(event: KeyboardEvent): boolean {
  return !isShortcutLayerSuspended() && !hasShortcutModifier(event)
}
