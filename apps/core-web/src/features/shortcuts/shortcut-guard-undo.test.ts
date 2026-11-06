import { describe, expect, it } from 'vitest'

import { isEditableControlFocused, isEligibleUndoShortcutEnabled } from './shortcut-guard'

describe('eligible undo shortcut guard', () => {
  it('does not intercept Cmd/Ctrl+Z while an input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
    })

    expect(isEditableControlFocused()).toBe(true)
    expect(isEligibleUndoShortcutEnabled(event)).toBe(false)

    input.remove()
  })
})
