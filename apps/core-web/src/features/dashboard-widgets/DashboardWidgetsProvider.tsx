import * as React from 'react'
import { generateId } from '@/lib/id'
import type { DashboardWidget } from '@/features/dashboard-widgets/types'

const STORAGE_PREFIX = 'acp:dashboard-widgets:'
const MAX_WIDGETS = 30

type CreateDashboardWidgetInput = Omit<DashboardWidget, 'id' | 'createdAt'>

type DashboardWidgetsContextValue = {
  widgets: DashboardWidget[]
  addWidget: (input: CreateDashboardWidgetInput) => void
  removeWidget: (id: string) => void
}

const DashboardWidgetsContext = React.createContext<DashboardWidgetsContextValue | null>(null)

function getStorageKey(userKey: string): string {
  return `${STORAGE_PREFIX}${userKey}`
}

function createWidgetId(): string {
  return generateId()
}

function loadWidgets(storageKey: string): DashboardWidget[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((entry): entry is DashboardWidget => {
        if (!entry || typeof entry !== 'object') return false
        const widget = entry as Partial<DashboardWidget>
        return (
          typeof widget.id === 'string' &&
          typeof widget.name === 'string' &&
          typeof widget.sourceKey === 'string' &&
          typeof widget.sourceLabel === 'string' &&
          typeof widget.href === 'string' &&
          typeof widget.displayType === 'string' &&
          typeof widget.createdAt === 'string'
        )
      })
      .slice(0, MAX_WIDGETS)
  } catch {
    return []
  }
}

type DashboardWidgetsProviderProps = {
  userKey: string
  children: React.ReactNode
}

export function DashboardWidgetsProvider({ userKey, children }: DashboardWidgetsProviderProps) {
  const storageKey = React.useMemo(() => getStorageKey(userKey), [userKey])
  const [widgets, setWidgets] = React.useState<DashboardWidget[]>(() => loadWidgets(storageKey))
  const [hydratedStorageKey, setHydratedStorageKey] = React.useState(storageKey)

  React.useEffect(() => {
    setWidgets(loadWidgets(storageKey))
    setHydratedStorageKey(storageKey)
  }, [storageKey])

  // hydratedStorageKey is set after loading widgets (in the first React.useEffect via setHydratedStorageKey)
  // to prevent writing to localStorage during initial hydration/when storageKey changes.
  // The effect should only persist widgets when hydratedStorageKey === storageKey.
  React.useEffect(() => {
    if (hydratedStorageKey !== storageKey) return
    window.localStorage.setItem(storageKey, JSON.stringify(widgets))
  }, [storageKey, hydratedStorageKey, widgets])

  const addWidget = React.useCallback((input: CreateDashboardWidgetInput) => {
    setWidgets((previous) => {
      const next: DashboardWidget = {
        ...input,
        id: createWidgetId(),
        createdAt: new Date().toISOString(),
      }
      return [next, ...previous].slice(0, MAX_WIDGETS)
    })
  }, [])

  const removeWidget = React.useCallback((id: string) => {
    setWidgets((previous) => previous.filter((widget) => widget.id !== id))
  }, [])

  const value = React.useMemo<DashboardWidgetsContextValue>(
    () => ({
      widgets,
      addWidget,
      removeWidget,
    }),
    [widgets, addWidget, removeWidget],
  )

  return <DashboardWidgetsContext.Provider value={value}>{children}</DashboardWidgetsContext.Provider>
}

export function useDashboardWidgets() {
  const context = React.useContext(DashboardWidgetsContext)
  if (!context) {
    throw new Error('useDashboardWidgets must be used within a DashboardWidgetsProvider.')
  }
  return context
}
