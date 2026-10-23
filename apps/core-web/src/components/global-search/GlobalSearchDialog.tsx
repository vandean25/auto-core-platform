import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import { CommandDialog, CommandInput, CommandList } from '@/components/ui/command'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearchContextActionGroup } from './GlobalSearchContextActionGroup'
import { QuickActionGroup } from './GlobalSearchResultGroups'
import { PrefixHelp, RecentItemsGroup, SearchResults } from './GlobalSearchResultGroupsView'
import {
  filterPaletteContextActions,
  type PaletteContextAction,
  type PaletteContextActionSection,
} from './global-search-context-actions'
import { useGlobalSearchPaletteContext } from './use-global-search-palette-context'
import { truncate } from './global-search-format'
import { getPaletteSections } from './global-search-navigation'
import { recentItemsKey, useRecentItems, type RecentSearchItem } from './global-search-recent'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type PaletteSubPage = {
  id: string
  heading: string
  items: PaletteContextAction[]
}

function getSessionSearchMeta(session: ReturnType<typeof useAuthSession>['data']) {
  if (!session) return { recentKey: null, roleInfo: null, activeSiteId: null }
  return {
    recentKey: recentItemsKey(session.userId, session.activeTenant.id),
    roleInfo: { platformRole: session.platformRole ?? null, activeRole: session.activeRole },
    activeSiteId: session.activeSiteId ?? null,
  }
}

function navigatePaletteHref(
  href: string,
  inNewTab: boolean,
  navigate: ReturnType<typeof useNavigate>,
) {
  if (inNewTab) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  navigate(href)
}

function handlePaletteInputKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  rawSearch: string,
  newTabRef: React.MutableRefObject<boolean>,
  popSubPage: () => boolean,
) {
  if (event.key === 'Enter') {
    newTabRef.current = event.metaKey || event.ctrlKey
    return
  }
  if (event.key === 'Backspace' && !rawSearch && popSubPage()) {
    event.preventDefault()
  }
}

type UsePaletteSubPagesArgs = {
  open: boolean
  query: string
  rootSection: PaletteContextActionSection | null
  defaultPlaceholder: string
  setSearch: (value: string) => void
  onOpenChange: (open: boolean) => void
}

function usePaletteSubPages({
  open,
  query,
  rootSection,
  defaultPlaceholder,
  setSearch,
  onOpenChange,
}: UsePaletteSubPagesArgs) {
  const [subPages, setSubPages] = React.useState<PaletteSubPage[]>([])

  React.useEffect(() => {
    if (!open) {
      setSearch('')
      setSubPages([])
    }
  }, [open, setSearch])

  const activeSubPage = subPages[subPages.length - 1]

  const popSubPage = () => {
    if (!activeSubPage) return false
    setSearch('')
    setSubPages((prev) => prev.slice(0, -1))
    return true
  }

  const runContextAction = (action: PaletteContextAction) => {
    const children = action.children
    if (children?.length) {
      setSearch('')
      setSubPages((prev) => [...prev, { id: action.id, heading: action.label, items: children }])
      return
    }
    setSearch('')
    setSubPages([])
    onOpenChange(false)
    action.onSelect()
  }

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (popSubPage()) event.preventDefault()
  }

  const contextSection = activeSubPage
    ? { heading: activeSubPage.heading, items: filterPaletteContextActions(activeSubPage.items, query) }
    : rootSection
  const placeholder = activeSubPage ? activeSubPage.heading : defaultPlaceholder

  return {
    isSubPage: Boolean(activeSubPage),
    contextSection,
    placeholder,
    popSubPage,
    runContextAction,
    handleEscapeKeyDown,
  }
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation(['nav', 'settings'])
  const [search, setSearch] = React.useState('')
  // Cmd/Ctrl+Enter or Cmd/Ctrl+click opens a new tab. cmdk's onSelect carries no event, so the modifier is read first.
  const newTabRef = React.useRef(false)
  const navigate = useNavigate()
  const sessionMeta = getSessionSearchMeta(useAuthSession().data)
  const sites = useMySites().data
  const { groups, isLoading, error } = useGlobalSearch(search)
  const recent = useRecentItems(sessionMeta.recentKey, open)

  React.useEffect(() => {
    if (open) void ensureNamespaceLoaded('settings')
  }, [open])

  const query = search.trim()
  const paletteContext = useGlobalSearchPaletteContext(open, query)
  const subPage = usePaletteSubPages({
    open,
    query,
    rootSection: paletteContext.contextSection,
    defaultPlaceholder: t('globalSearch.placeholder'),
    setSearch,
    onOpenChange,
  })
  const sections = getPaletteSections(sessionMeta.roleInfo, query, paletteContext.intakePrefill)

  const openHref = (href: string) => {
    const inNewTab = newTabRef.current
    newTabRef.current = false
    setSearch('')
    onOpenChange(false)
    navigatePaletteHref(href, inNewTab, navigate)
  }

  const openItem = (item: RecentSearchItem) => {
    recent.add(item)
    openHref(item.href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={subPage.handleEscapeKeyDown}
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      shouldFilter={false}
    >
      <CommandInput
        aria-label={t('globalSearch.inputLabel')}
        placeholder={subPage.placeholder}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(event) => handlePaletteInputKeyDown(event, search, newTabRef, subPage.popSubPage)}
      />

      <CommandList
        className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2"
        onClickCapture={(event) => {
          newTabRef.current = event.metaKey || event.ctrlKey
        }}
      >
        {subPage.contextSection ? (
          <GlobalSearchContextActionGroup
            section={subPage.contextSection}
            onSelect={subPage.runContextAction}
          />
        ) : null}

        {!subPage.isSubPage ? (
          <>
            {query ? (
              <SearchResults
                groups={groups}
                isLoading={isLoading}
                error={error}
                hasSections={sections.length > 0}
                activeSiteId={sessionMeta.activeSiteId}
                sites={sites ?? []}
                query={truncate(query)}
                onSelect={openItem}
              />
            ) : (
              <>
                <RecentItemsGroup items={recent.items} onSelect={openItem} onRemove={recent.remove} />
                <PrefixHelp />
              </>
            )}

            {sections.map((section) => (
              <QuickActionGroup key={section.heading} section={section} onSelect={openHref} />
            ))}
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
