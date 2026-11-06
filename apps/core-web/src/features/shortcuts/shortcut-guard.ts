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

const EDITABLE_ROLE_SELECTOR =
  '[role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [contenteditable]:not([contenteditable="false"])'

/** Text entry or typeahead owner: inputs, textareas, selects, contenteditable and ARIA equivalents. */
export function isEditableElement(element: EventTarget | null): boolean {
  if (!(element instanceof Element)) {
    return false
  }
  const tagName = element.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }
  return (
    (element instanceof HTMLElement && element.isContentEditable) ||
    element.closest(EDITABLE_ROLE_SELECTOR) !== null
  )
}

export function isEditableControlFocused(): boolean {
  return typeof document !== 'undefined' && isEditableElement(document.activeElement)
}

/** IME composition: the browser reports keyCode 229 / isComposing while a candidate is being built. */
export function isComposingKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** Plain character: browser/AT modifier chords (Ctrl, Cmd, Alt/AltGr) never qualify; Shift only for `?`. */
export function isPlainShortcutKey(event: KeyboardEvent): boolean {
  return !hasShortcutModifier(event) && (!event.shiftKey || event.key === '?')
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

/** True when the keystroke is not ours: handled already, composing, chord, or typed into/over an editable control. */
export function shouldIgnoreShortcutEvent(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    isComposingKeyEvent(event) ||
    !isPlainShortcutKey(event) ||
    isShortcutLayerSuspended() ||
    isEditableElement(event.target) ||
    isEditableControlFocused()
  )
}
