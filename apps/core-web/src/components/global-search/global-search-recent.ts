import { useState } from 'react'
import type { SearchResult } from '@/api/search'
import { SEARCH_TYPE_REGISTRY } from './global-search-types'

export const MAX_RECENT_ITEMS = 8

/** Only what the result already showed in the palette. */
export type RecentSearchItem = Pick<SearchResult, 'type' | 'id' | 'title' | 'subtitle' | 'href'>

export function recentItemsKey(userId: string, tenantId: string): string {
  return `acp:global-search:recent:${userId}:${tenantId}`
}

const isSameItem = (a: RecentSearchItem, b: RecentSearchItem) => a.type === b.type && a.id === b.id

const isString = (value: unknown): value is string => typeof value === 'string'

// Same-origin app routes only: storage content must never send the user elsewhere.
const isAppHref = (value: unknown) => isString(value) && value.startsWith('/') && !value.startsWith('//')

function isRecentItem(value: unknown): value is RecentSearchItem {
  const item = value as Partial<RecentSearchItem> | null
  return (
    isString(item?.id) &&
    isString(item.title) &&
    isString(item.type) &&
    item.type in SEARCH_TYPE_REGISTRY &&
    (item.subtitle === null || isString(item.subtitle)) &&
    isAppHref(item.href)
  )
}

export function readRecentItems(key: string): RecentSearchItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, MAX_RECENT_ITEMS) : []
  } catch {
    return []
  }
}

function writeRecentItems(key: string, items: RecentSearchItem[]): RecentSearchItem[] {
  try {
    window.localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // Storage can be full or blocked; recent items are a convenience.
  }
  return items
}

export function addRecentItem(key: string, item: RecentSearchItem): RecentSearchItem[] {
  const { type, id, title, subtitle, href } = item
  const rest = readRecentItems(key).filter((entry) => !isSameItem(entry, item))
  return writeRecentItems(key, [{ type, id, title, subtitle, href }, ...rest].slice(0, MAX_RECENT_ITEMS))
}

export function removeRecentItem(key: string, item: RecentSearchItem): RecentSearchItem[] {
  return writeRecentItems(
    key,
    readRecentItems(key).filter((entry) => !isSameItem(entry, item)),
  )
}

/** The recent items of one user and tenant. A bump re-renders the palette after an add or remove. */
export function useRecentItems(key: string | null, open: boolean) {
  const [, setVersion] = useState(0)
  const bump = () => setVersion((current) => current + 1)
  // The list is at most 8 entries, so reading the storage on each render is cheaper than caching it.
  const items = key && open ? readRecentItems(key) : []

  return {
    items,
    add: (item: RecentSearchItem) => {
      if (key) addRecentItem(key, item)
      bump()
    },
    remove: (item: RecentSearchItem) => {
      if (key) removeRecentItem(key, item)
      bump()
    },
  }
}
