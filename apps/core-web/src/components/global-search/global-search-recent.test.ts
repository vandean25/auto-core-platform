// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addRecentItem,
  readRecentItems,
  recentItemsKey,
  removeRecentItem,
  type RecentSearchItem,
} from './global-search-recent'

const item = (n: number): RecentSearchItem => ({
  type: 'customer',
  id: `id-${n}`,
  title: `Kunde ${n}`,
  subtitle: null,
  href: `/customers/id-${n}`,
})

const key = recentItemsKey('user-1', 'tenant-1')

describe('recent search items', () => {
  beforeEach(() => window.localStorage.clear())

  it('scopes the storage key to user and tenant', () => {
    expect(recentItemsKey('user-1', 'tenant-1')).not.toBe(recentItemsKey('user-2', 'tenant-1'))
    expect(recentItemsKey('user-1', 'tenant-1')).not.toBe(recentItemsKey('user-1', 'tenant-2'))
  })

  it('keeps each user and tenant list separate', () => {
    addRecentItem(key, item(1))

    expect(readRecentItems(recentItemsKey('user-2', 'tenant-1'))).toEqual([])
    expect(readRecentItems(key)).toEqual([item(1)])
  })

  it('puts the newest item first and keeps at most 8', () => {
    for (let n = 1; n <= 10; n += 1) addRecentItem(key, item(n))

    const stored = readRecentItems(key)
    expect(stored).toHaveLength(8)
    expect(stored[0].id).toBe('id-10')
    expect(stored[7].id).toBe('id-3')
  })

  it('dedupes by type and id and moves the item to the front', () => {
    addRecentItem(key, item(1))
    addRecentItem(key, item(2))
    addRecentItem(key, { ...item(1), title: 'Kunde 1 neu' })

    expect(readRecentItems(key).map((entry) => entry.title)).toEqual(['Kunde 1 neu', 'Kunde 2'])
  })

  it('treats the same id under another type as a different item', () => {
    addRecentItem(key, item(1))
    addRecentItem(key, { ...item(1), type: 'vehicle', href: '/vehicles/id-1' })

    expect(readRecentItems(key)).toHaveLength(2)
  })

  it('removes one item', () => {
    addRecentItem(key, item(1))
    addRecentItem(key, item(2))

    expect(removeRecentItem(key, item(1))).toEqual([item(2)])
    expect(readRecentItems(key)).toEqual([item(2)])
  })

  it('stores only the fields the result showed', () => {
    addRecentItem(key, { ...item(1), score: 1, siteId: 'site-1' } as RecentSearchItem)

    expect(Object.keys(readRecentItems(key)[0]).sort()).toEqual(['href', 'id', 'subtitle', 'title', 'type'])
  })

  it('ignores corrupt storage and entries with an unsafe href', () => {
    window.localStorage.setItem(key, '{nope')
    expect(readRecentItems(key)).toEqual([])

    window.localStorage.setItem(
      key,
      JSON.stringify([item(1), { ...item(2), href: 'https://evil.example/x' }, { ...item(3), type: 'other' }, { ...item(4), type: 'toString' }]),
    )
    expect(readRecentItems(key)).toEqual([item(1)])
  })
})
