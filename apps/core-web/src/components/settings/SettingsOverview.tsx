import * as React from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  getSettingsSectionPath,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_META,
  type SettingsTab,
} from '@/pages/settings-page-tabs'

type SettingsOverviewProps = {
  visibleTabs: readonly SettingsTab[]
}

export function SettingsOverview({ visibleTabs }: SettingsOverviewProps) {
  const { t } = useTranslation('settings')
  const [query, setQuery] = React.useState('')
  const visibleSet = React.useMemo(() => new Set(visibleTabs), [visibleTabs])
  const normalizedQuery = query.trim().toLowerCase()

  const filteredGroups = React.useMemo(() => {
    return SETTINGS_GROUPS.map((group) => {
      const items = group.tabs
        .filter((tab) => visibleSet.has(tab))
        .map((tab) => {
          const meta = SETTINGS_SECTION_META[tab]
          return {
            id: tab,
            icon: meta.icon,
            label: t(meta.labelKey),
            description: t(meta.descriptionKey),
          }
        })
        .filter((item) => {
          if (!normalizedQuery) return true
          return (
            item.label.toLowerCase().includes(normalizedQuery) ||
            item.description.toLowerCase().includes(normalizedQuery)
          )
        })
      return {
        id: group.id,
        title: t(group.labelKey),
        items,
      }
    }).filter((group) => group.items.length > 0)
  }, [normalizedQuery, t, visibleSet])

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={t('page.title')}
        actions={
          <div className="relative w-full sm:w-72">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('overview.searchPlaceholder')}
              aria-label={t('overview.searchLabel')}
              className="min-h-11 pl-9 pr-9 sm:min-h-9"
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('overview.clearSearch')}
                onClick={() => setQuery('')}
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        }
      />

      {filteredGroups.length === 0 ? (
        <Empty className="rounded-lg border border-border bg-card">
          <EmptyDescription>{t('overview.empty')}</EmptyDescription>
          <EmptyContent>
            <Button type="button" variant="outline" onClick={() => setQuery('')}>
              {t('overview.clearSearch')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <Card key={group.id} data-testid={`settings-group-${group.id}`}>
              <CardHeader className="pb-3">
                <CardTitle as="h2" className="text-base font-semibold">
                  {group.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.id}
                        to={getSettingsSectionPath(item.id)}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">{item.label}</div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
