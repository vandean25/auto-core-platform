import { useCallback, useState } from 'react'

/**
 * The key and value of the first sidebar release stay as they are, so a saved preference still
 * applies after the redesign. The stored value is `'true'` when the sidebar shows icons only.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'acp:sidebar-collapsed'
const SIDEBAR_GROUPS_STORAGE_KEY = 'acp:sidebar-groups'

type SidebarGroupState = Record<string, boolean>

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeStoredCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // Storage can be blocked (private window, cleared site data). The sidebar still works for this visit.
  }
}

function readStoredGroupState(): SidebarGroupState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(Object.entries(parsed).filter(([, open]) => typeof open === 'boolean'))
  } catch {
    return {}
  }
}

function writeStoredGroupState(state: SidebarGroupState) {
  try {
    window.localStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Same as writeStoredCollapsed: the groups keep their state until the page is reloaded.
  }
}

/** Whether the sidebar is expanded. Expanded is the default, and the choice is kept per browser. */
export function useSidebarOpen() {
  const [open, setOpenState] = useState(() => !readStoredCollapsed())

  const setOpen = useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen)
    writeStoredCollapsed(!nextOpen)
  }, [])

  return [open, setOpen] as const
}

/** Open state of one navigation group. Groups start open, and the choice is kept per browser. */
export function useSidebarGroupOpen(groupId: string) {
  const [open, setOpenState] = useState(() => readStoredGroupState()[groupId] ?? true)

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      setOpenState(nextOpen)
      writeStoredGroupState({ ...readStoredGroupState(), [groupId]: nextOpen })
    },
    [groupId],
  )

  return [open, setOpen] as const
}
