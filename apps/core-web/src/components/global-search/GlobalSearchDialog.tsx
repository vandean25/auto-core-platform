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

function usePaletteSubPages(
  open: boolean,
  query: string,
  setSearch: (value: string) => void,
  onOpenChange: (open: boolean) => void,
) {
  const [subPages, setSubPages] = React.useState<PaletteSubPage[]>([])

  React.useEffect(() => {
    if (!open) setSubPages([])
  }, [open])

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

  const subPageSection = activeSubPage
    ? { heading: activeSubPage.heading, items: filterPaletteContextActions(activeSubPage.items, query) }
    : null

  return { activeSubPage, subPageSection, popSubPage, runContextAction }
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation(['nav', 'settings'])
  const [search, setSearch] = React.useState('')
  // Cmd/Ctrl+Enter or Cmd/Ctrl+click opens a new tab. cmdk's onSelect carries no event, so the modifier is read first.
  const newTabRef = React.useRef(false)
  const navigate = useNavigate()
  const session = useAuthSession().data
  const sites = useMySites().data
  const { groups, isLoading, error } = useGlobalSearch(search)
  const recent = useRecentItems(session ? recentItemsKey(session.userId, session.activeTenant.id) : null, open)

  React.useEffect(() => {
    if (open) void ensureNamespaceLoaded('settings')
    else setSearch('')
  }, [open])

  const query = search.trim()
  const paletteContext = useGlobalSearchPaletteContext(open, query)
  const subPage = usePaletteSubPages(open, query, setSearch, onOpenChange)
  const sections = getPaletteSections(
    session ? { platformRole: session.platformRole ?? null, activeRole: session.activeRole } : null,
    query,
    paletteContext.intakePrefill,
  )
  const contextSection = subPage.subPageSection ?? paletteContext.contextSection

  const openHref = (href: string) => {
    const inNewTab = newTabRef.current
    newTabRef.current = false
    setSearch('')
    onOpenChange(false)
    if (inNewTab) window.open(href, '_blank', 'noopener,noreferrer')
    else navigate(href)
  }

  const openItem = (item: RecentSearchItem) => {
    recent.add(item)
    openHref(item.href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={(event) => {
        if (subPage.popSubPage()) event.preventDefault()
      }}
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      shouldFilter={false}
    >
      <CommandInput
        aria-label={t('globalSearch.inputLabel')}
        placeholder={subPage.activeSubPage?.heading ?? t('globalSearch.placeholder')}
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
        {contextSection ? (
          <GlobalSearchContextActionGroup
            section={contextSection}
            onSelect={subPage.runContextAction}
          />
        ) : null}

        {!subPage.activeSubPage ? (
          <>
            {query ? (
              <SearchResults
                groups={groups}
                isLoading={isLoading}
                error={error}
                hasSections={sections.length > 0}
                activeSiteId={session?.activeSiteId ?? null}
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
