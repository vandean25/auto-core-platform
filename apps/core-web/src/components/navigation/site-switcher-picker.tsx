import { Loader2, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MeSite } from '@/api/sites'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type SitePickerProps = {
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitching: boolean
  onSwitch: (siteId: string) => void
  compact?: boolean
}

export function SitePicker({
  activeSiteId,
  sites,
  isLoadingSites,
  isSwitching,
  onSwitch,
  compact = false,
}: SitePickerProps) {
  const { t } = useTranslation('nav')
  const activeSite = sites.find((site) => site.id === activeSiteId)

  return (
    <Select value={activeSite?.id ?? undefined} onValueChange={onSwitch} disabled={isSwitching}>
      <SelectTrigger
        aria-label={t('siteSwitcher.switchSite')}
        className={
          compact
            ? 'h-10 w-full'
            : 'h-9 border-slate-700 bg-slate-950 text-slate-200 focus:ring-slate-500'
        }
      >
        {isLoadingSites ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <SelectValue placeholder={t('siteSwitcher.selectSite')} />
        )}
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            {site.name}
            <span className="ml-2 text-xs text-slate-400">{site.code}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ReadOnlyCurrentSite({
  siteName,
  collapsed = false,
}: {
  siteName: string
  collapsed?: boolean
}) {
  const { t } = useTranslation('nav')
  const label = `${t('siteSwitcher.currentSite')}: ${siteName}`

  if (collapsed) {
    return (
      <div className="px-2 pt-3">
        <div
          role="img"
          className="flex h-10 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300"
          title={label}
          aria-label={label}
        >
          <MapPin className="h-4 w-4" />
        </div>
      </div>
    )
  }

  return (
    <section className="px-3 pt-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {t('siteSwitcher.currentSite')}
        </p>
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate font-medium">{siteName}</span>
        </div>
      </div>
    </section>
  )
}
