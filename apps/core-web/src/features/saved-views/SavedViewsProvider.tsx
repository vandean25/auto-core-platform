import * as React from 'react'
import { generateId } from '@/lib/id'

const STORAGE_PREFIX = 'acp:saved-views:'
const MAX_SAVED_VIEWS = 30

export type SavedView = {
  id: string
  name: string
  href: string
  createdAt: string
}

type CreateSavedViewInput = {
  name: string
  href: string
}

type SavedViewsContextValue = {
  savedViews: SavedView[]
  addSavedView: (input: CreateSavedViewInput) => { created: boolean; reason?: 'duplicate' | 'invalid' }
  removeSavedView: (id: string) => void
}

const SavedViewsContext = React.createContext<SavedViewsContextValue | null>(null)

function normalizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed, 'http://localhost')
    const params = new URLSearchParams(url.search)
    params.sort()
    const normalizedQuery = params.toString()
    return `${url.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`
  } catch {
    return trimmed
  }
}

function getStorageKey(userKey: string): string {
  return `${STORAGE_PREFIX}${userKey}`
}

function loadSavedViews(storageKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is SavedView => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as Partial<SavedView>
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          typeof candidate.href === 'string' &&
          typeof candidate.createdAt === 'string'
        )
      })
      .map((item) => ({ ...item, href: normalizeHref(item.href) }))
      .filter((item) => !!item.href)
      .slice(0, MAX_SAVED_VIEWS)
  } catch {
    return []
  }
}

function persistSavedViews(storageKey: string, savedViews: SavedView[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(savedViews))
}

function createSavedViewId(): string {
  return generateId()
}

type SavedViewsProviderProps = {
  userKey: string
  children: React.ReactNode
}

export function SavedViewsProvider({ userKey, children }: SavedViewsProviderProps) {
  const storageKey = React.useMemo(() => getStorageKey(userKey), [userKey])
  const [savedViews, setSavedViews] = React.useState<SavedView[]>(() => loadSavedViews(storageKey))
  const [hydratedStorageKey, setHydratedStorageKey] = React.useState(storageKey)
  const savedViewsRef = React.useRef<SavedView[]>(savedViews)

  React.useEffect(() => {
    savedViewsRef.current = savedViews
  }, [savedViews])

  React.useEffect(() => {
    setSavedViews(loadSavedViews(storageKey))
    setHydratedStorageKey(storageKey)
  }, [storageKey])

  React.useEffect(() => {
    if (hydratedStorageKey !== storageKey) return
    persistSavedViews(storageKey, savedViews)
  }, [storageKey, hydratedStorageKey, savedViews])

  const addSavedView = React.useCallback(
    ({ name, href }: CreateSavedViewInput): { created: boolean; reason?: 'duplicate' | 'invalid' } => {
      const normalizedName = name.trim()
      const normalizedHref = normalizeHref(href)

      if (!normalizedName || !normalizedHref) {
        return { created: false, reason: 'invalid' }
      }

      const duplicate = savedViewsRef.current.some(
        (view) => view.href === normalizedHref && view.name.toLowerCase() === normalizedName.toLowerCase(),
      )
      if (duplicate) {
        return { created: false, reason: 'duplicate' }
      }

      const next: SavedView = {
        id: createSavedViewId(),
        name: normalizedName,
        href: normalizedHref,
        createdAt: new Date().toISOString(),
      }
      setSavedViews((previous) => [next, ...previous].slice(0, MAX_SAVED_VIEWS))
      return { created: true }
    },
    [],
  )

  const removeSavedView = React.useCallback((id: string) => {
    setSavedViews((previous) => previous.filter((view) => view.id !== id))
  }, [])

  const value = React.useMemo<SavedViewsContextValue>(
    () => ({
      savedViews,
      addSavedView,
      removeSavedView,
    }),
    [savedViews, addSavedView, removeSavedView],
  )

  return <SavedViewsContext.Provider value={value}>{children}</SavedViewsContext.Provider>
}

export function useSavedViews() {
  const context = React.useContext(SavedViewsContext)
  if (!context) {
    throw new Error('useSavedViews must be used within a SavedViewsProvider.')
  }
  return context
}
