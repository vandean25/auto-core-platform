import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readSidebarCollapsed,
  readSidebarGroupState,
  useSidebarGroupOpen,
  writeSidebarCollapsed,
  writeSidebarGroupState,
} from './sidebar-state'

const COLLAPSED_KEY = 'acp:sidebar-collapsed'
const GROUPS_KEY = 'acp:sidebar-groups'

beforeEach(() => {
  window.localStorage.clear()
})

describe('sidebar collapsed preference', () => {
  it('starts expanded when nothing is stored', () => {
    expect(readSidebarCollapsed()).toBe(false)
  })

  it('reads the value the first release stored under the same key', () => {
    window.localStorage.setItem(COLLAPSED_KEY, 'true')
    expect(readSidebarCollapsed()).toBe(true)

    window.localStorage.setItem(COLLAPSED_KEY, 'false')
    expect(readSidebarCollapsed()).toBe(false)
  })

  it('writes the value in the same format', () => {
    writeSidebarCollapsed(true)

    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('true')
    expect(readSidebarCollapsed()).toBe(true)
  })

  it('falls back to expanded and does not throw when storage is blocked', () => {
    vi.mocked(window.localStorage.getItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    expect(readSidebarCollapsed()).toBe(false)

    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    expect(() => writeSidebarCollapsed(true)).not.toThrow()
  })
})

describe('sidebar group state', () => {
  it('is empty when nothing is stored', () => {
    expect(readSidebarGroupState()).toEqual({})
  })

  it('keeps only the boolean entries of the stored object', () => {
    window.localStorage.setItem(GROUPS_KEY, '{"sales":false,"finance":"yes","overview":true}')

    expect(readSidebarGroupState()).toEqual({ sales: false, overview: true })
  })

  it.each(['not json', '[true]', 'null', '42'])('ignores the stored value %s', (raw) => {
    window.localStorage.setItem(GROUPS_KEY, raw)

    expect(readSidebarGroupState()).toEqual({})
  })

  it('writes the whole map as JSON', () => {
    writeSidebarGroupState({ sales: false })

    expect(window.localStorage.getItem(GROUPS_KEY)).toBe('{"sales":false}')
  })

  it('falls back to an empty map when storage is blocked', () => {
    vi.mocked(window.localStorage.getItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })

    expect(readSidebarGroupState()).toEqual({})
  })
})

describe('useSidebarGroupOpen', () => {
  it('starts open for a group without a stored choice', () => {
    const { result } = renderHook(() => useSidebarGroupOpen('sales'))

    expect(result.current[0]).toBe(true)
  })

  it('starts closed when the group was closed before', () => {
    window.localStorage.setItem(GROUPS_KEY, '{"sales":false}')

    const { result } = renderHook(() => useSidebarGroupOpen('sales'))

    expect(result.current[0]).toBe(false)
  })

  it('stores a change and keeps the state of the other groups', () => {
    window.localStorage.setItem(GROUPS_KEY, '{"finance":false}')
    const { result } = renderHook(() => useSidebarGroupOpen('sales'))

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
    expect(readSidebarGroupState()).toEqual({ finance: false, sales: false })
  })

  it('reads the stored choice again after a remount', () => {
    const first = renderHook(() => useSidebarGroupOpen('workshop'))
    act(() => first.result.current[1](false))
    first.unmount()

    const second = renderHook(() => useSidebarGroupOpen('workshop'))

    expect(second.result.current[0]).toBe(false)
  })

  it('keeps the change in memory when storage is blocked', () => {
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    const { result } = renderHook(() => useSidebarGroupOpen('vehicles'))

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
  })
})
