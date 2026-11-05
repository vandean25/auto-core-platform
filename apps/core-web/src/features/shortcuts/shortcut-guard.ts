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

export function isEditableControlFocused(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const active = document.activeElement
  if (!active) {
    return false
  }
  const tagName = active.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    return true
  }
  return false
}

/** Latest eligible undo only; never intercept native text undo in editable controls. */
export function isEligibleUndoShortcutEnabled(event: KeyboardEvent): boolean {
  if (isShortcutLayerSuspended() || isEditableControlFocused()) {
    return false
  }
  const key = event.key.toLowerCase()
  if (key !== 'z') {
    return false
  }
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}
