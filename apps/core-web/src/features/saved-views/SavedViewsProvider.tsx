import * as React from 'react'
import { generateId } from '@/lib/id'

const STORAGE_PREFIX = 'acp:saved-views:'
const MAX_SAVED_VIEWS = 30
/** Table state that describes a position in the result, not a way of looking at it: a saved view starts on page 1. */
const TRANSIENT_PARAMS = ['page', 'peek', 'action'] as const

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

type SavedViewResult = { ok: boolean; reason?: 'duplicate' | 'invalid' }

type SavedViewsContextValue = {
  savedViews: SavedView[]
  addSavedView: (input: CreateSavedViewInput) => { created: boolean; reason?: 'duplicate' | 'invalid' }
  renameSavedView: (id: string, name: string) => SavedViewResult
  removeSavedView: (id: string) => void
}

const SavedViewsContext = React.createContext<SavedViewsContextValue | null>(null)

function normalizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed, 'http://localhost')
    const params = new URLSearchParams(url.search)
    for (const key of TRANSIENT_PARAMS) params.delete(key)
    params.sort()
    const normalizedQuery = params.toString()
    return `${url.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`
  } catch {
    return trimmed
  }
}

/** Per user and tenant (AUT-880): another tenant's views never load, and stay stored for when the user returns. */
export function savedViewsStorageKey(userKey: string, tenantId: string | null): string {
  return `${STORAGE_PREFIX}${userKey}:${tenantId ?? 'none'}`
}

/**
 * Views saved before tenant scoping sit under the user-only key. They move once into the first tenant that loads;
 * the legacy key is then gone, so no second tenant ever sees them.
 */
function adoptLegacyViews(storageKey: string, legacyKey: string): string | null {
  try {
    const legacy = window.localStorage.getItem(legacyKey)
    if (legacy === null) return null
    window.localStorage.setItem(storageKey, legacy)
    window.localStorage.removeItem(legacyKey)
    return legacy
  } catch {
    return null
  }
}

function loadSavedViews(storageKey: string, legacyKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storageKey) ?? adoptLegacyViews(storageKey, legacyKey)
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

/** The list a saved view belongs to, so a list's menu shows only its own views. */
export function savedViewPath(href: string): string {
  return href.split('?')[0]
}

function persistSavedViews(storageKey: string, savedViews: SavedView[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(savedViews))
}

function createSavedViewId(): string {
  return generateId()
}

type SavedViewsProviderProps = {
  userKey: string
  /** Null for a session without an active tenant (a platform admin outside any tenant). */
  tenantId?: string | null
  children: React.ReactNode
}

function SavedViewsStore({ storageKey, legacyKey, children }: { storageKey: string; legacyKey: string; children: React.ReactNode }) {
  const [savedViews, setSavedViews] = React.useState<SavedView[]>(() => loadSavedViews(storageKey, legacyKey))
  const savedViewsRef = React.useRef<SavedView[]>(savedViews)

  React.useEffect(() => {
    savedViewsRef.current = savedViews
    persistSavedViews(storageKey, savedViews)
  }, [storageKey, savedViews])

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

  const renameSavedView = React.useCallback((id: string, name: string): SavedViewResult => {
    const normalizedName = name.trim()
    const target = savedViewsRef.current.find((view) => view.id === id)
    if (!normalizedName || !target) return { ok: false, reason: 'invalid' }

    // Same rule as saving: one name per list, whatever the casing.
    const taken = savedViewsRef.current.some(
      (view) =>
        view.id !== id &&
        savedViewPath(view.href) === savedViewPath(target.href) &&
        view.name.toLowerCase() === normalizedName.toLowerCase(),
    )
    if (taken) return { ok: false, reason: 'duplicate' }

    setSavedViews((previous) => previous.map((view) => (view.id === id ? { ...view, name: normalizedName } : view)))
    return { ok: true }
  }, [])

  const removeSavedView = React.useCallback((id: string) => {
    setSavedViews((previous) => previous.filter((view) => view.id !== id))
  }, [])

  const value = React.useMemo<SavedViewsContextValue>(
    () => ({ savedViews, addSavedView, renameSavedView, removeSavedView }),
    [savedViews, addSavedView, renameSavedView, removeSavedView],
  )

  return <SavedViewsContext.Provider value={value}>{children}</SavedViewsContext.Provider>
}

export function SavedViewsProvider({ userKey, tenantId = null, children }: SavedViewsProviderProps) {
  const storageKey = savedViewsStorageKey(userKey, tenantId)
  // Keyed by the storage key: a tenant or user change mounts a fresh store, so no render shows the previous one's views.
  return (
    <SavedViewsStore key={storageKey} storageKey={storageKey} legacyKey={`${STORAGE_PREFIX}${userKey}`}>
      {children}
    </SavedViewsStore>
  )
}

export function useSavedViews() {
  const context = React.useContext(SavedViewsContext)
  if (!context) {
    throw new Error('useSavedViews must be used within a SavedViewsProvider.')
  }
  return context
}

/**
 * For surfaces that can also render outside a provider (the mechanic shell has none): no views instead of a throw.
 */
export function useOptionalSavedViews(): SavedView[] {
  return React.useContext(SavedViewsContext)?.savedViews ?? []
}
