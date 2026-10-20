import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarGroupOpen, useSidebarOpen } from './sidebar-state'

const COLLAPSED_KEY = 'acp:sidebar-collapsed'
const GROUPS_KEY = 'acp:sidebar-groups'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useSidebarOpen', () => {
  it('starts expanded when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarOpen())

    expect(result.current[0]).toBe(true)
  })

  it('reads the collapsed value that the first release stored under the same key', () => {
    window.localStorage.setItem(COLLAPSED_KEY, 'true')

    const { result } = renderHook(() => useSidebarOpen())

    expect(result.current[0]).toBe(false)
  })

  it('stores a change under the same key and value format', () => {
    const { result } = renderHook(() => useSidebarOpen())

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('true')

    act(() => result.current[1](true))

    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('false')
  })

  it('starts expanded and keeps the change in memory when storage is blocked', () => {
    vi.mocked(window.localStorage.getItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    const { result } = renderHook(() => useSidebarOpen())
    expect(result.current[0]).toBe(true)

    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
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

  it.each(['{"sales":"no"}', 'not json', '[false]', 'null'])('ignores the stored value %s', (raw) => {
    window.localStorage.setItem(GROUPS_KEY, raw)

    const { result } = renderHook(() => useSidebarGroupOpen('sales'))

    expect(result.current[0]).toBe(true)
  })

  it('stores a change and keeps the state of the other groups', () => {
    window.localStorage.setItem(GROUPS_KEY, '{"finance":false}')
    const { result } = renderHook(() => useSidebarGroupOpen('sales'))

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? '{}')).toEqual({ finance: false, sales: false })
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
