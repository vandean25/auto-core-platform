import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import { CommandDialog, CommandInput, CommandList } from '@/components/ui/command'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { QuickActionGroup } from './GlobalSearchResultGroups'
import { PrefixHelp, RecentItemsGroup, SearchResults } from './GlobalSearchResultGroupsView'
import { truncate } from './global-search-format'
import { getPaletteSections } from './global-search-navigation'
import { recentItemsKey, useRecentItems, type RecentSearchItem } from './global-search-recent'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  }, [open])

  const query = search.trim()
  const sections = getPaletteSections(
    session ? { platformRole: session.platformRole ?? null, activeRole: session.activeRole } : null,
    query,
  )

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
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      shouldFilter={false}
    >
      <CommandInput
        aria-label={t('globalSearch.inputLabel')}
        placeholder={t('globalSearch.placeholder')}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(event) => {
          if (event.key === 'Enter') newTabRef.current = event.metaKey || event.ctrlKey
        }}
      />

      <CommandList
        className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2"
        onClickCapture={(event) => {
          newTabRef.current = event.metaKey || event.ctrlKey
        }}
      >
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
      </CommandList>
    </CommandDialog>
  )
}
