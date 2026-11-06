import { beforeEach, describe, expect, it } from 'vitest'

import {
  bindSingleKeyShortcutsUser,
  isSingleKeyShortcutsEnabled,
  setSingleKeyShortcutsEnabled,
} from './single-key-shortcuts-setting'

describe('single-key shortcuts setting', () => {
  beforeEach(() => window.localStorage.clear())

  // Regression guard: the choice is per user in localStorage (ADR-0036 R5), on by default, with no backend preference.
  it('is on by default, and each user keeps their own stored choice', () => {
    bindSingleKeyShortcutsUser('user-a')
    expect(isSingleKeyShortcutsEnabled()).toBe(true)

    setSingleKeyShortcutsEnabled(false)
    bindSingleKeyShortcutsUser('user-b')
    expect(isSingleKeyShortcutsEnabled()).toBe(true)

    bindSingleKeyShortcutsUser('user-a')
    expect(isSingleKeyShortcutsEnabled()).toBe(false)
  })
})
