import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SettingsTab } from './settings-page-tabs'

type SettingsTabNavProps = {
  tabs: readonly SettingsTab[]
  labels: Record<SettingsTab, string>
  active: SettingsTab
  onChange: (tab: SettingsTab) => void
}

/**
 * Navigation between the settings sections. On a phone one select lists all sections (the strip showed two and a
 * half of them); from `md` it is the tab strip, which scrolls the active tab into view.
 */
export function SettingsTabNav({ tabs, labels, active, onChange }: SettingsTabNavProps) {
  const { t } = useTranslation('settings')
  const stripRef = React.useRef<HTMLDivElement>(null)
  // Tab widths follow the label text, so the strip is positioned again when the language changes.
  const activeLabel = labels[active]

  React.useEffect(() => {
    // Scroll the strip itself: scrollIntoView would also scroll the page sideways.
    const strip = stripRef.current
    const trigger = strip?.querySelector<HTMLElement>('[data-state="active"]')
    if (!strip || !trigger) return
    const stripBox = strip.getBoundingClientRect()
    const triggerBox = trigger.getBoundingClientRect()
    strip.scrollLeft += triggerBox.left - stripBox.left - (stripBox.width - triggerBox.width) / 2
  }, [active, activeLabel, tabs.length])

  return (
    <>
      <Select value={active} onValueChange={(value) => onChange(value as SettingsTab)}>
        <SelectTrigger className="min-h-11 w-full md:hidden" aria-label={t('page.sectionLabel')} data-testid="settings-section-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {tabs.map((tab) => (
            <SelectItem key={tab} value={tab} className="min-h-11">
              {labels[tab]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TabsList ref={stripRef} data-testid="settings-tab-strip" className="flex h-auto w-full max-w-[1300px] justify-start gap-1 overflow-x-auto max-md:hidden">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} className="shrink-0" value={tab}>
            {labels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  )
}
