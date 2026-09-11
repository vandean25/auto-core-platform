import { Loader2, MapPin } from 'lucide-react'
import type { MeSite } from '@/api/sites'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SiteSwitcherProps = {
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitching: boolean
  onSwitch: (siteId: string) => void
  collapsed?: boolean
}

type SitePickerProps = {
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitching: boolean
  onSwitch: (siteId: string) => void
  compact?: boolean
}

function SitePicker({
  activeSiteId,
  sites,
  isLoadingSites,
  isSwitching,
  onSwitch,
  compact = false,
}: SitePickerProps) {
  const activeSite = sites.find((site) => site.id === activeSiteId)

  return (
    <Select
      value={activeSite?.id ?? undefined}
      onValueChange={onSwitch}
      disabled={isSwitching}
    >
      <SelectTrigger
        aria-label="Switch site"
        className={
          compact
            ? 'h-10 w-full'
            : 'h-9 border-slate-700 bg-slate-950 text-slate-200 focus:ring-slate-500'
        }
      >
        {isLoadingSites ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <SelectValue placeholder="Select site" />
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

/**
 * Current-site switcher (UX Compliance / Site switcher).
 *
 * - Hidden entirely when the user has exactly one active grant AND that site
 *   is already the session's active site.
 * - Shown as a recovery prompt/action when `active_site_id` is null (tenant
 *   switch, membership revoke, site deactivation) even with a single remaining
 *   grant — operational APIs return `ACTIVE_SITE_REQUIRED` until the PATCH.
 * - Otherwise a dropdown of `GET /me/sites` (active sites only, ruling 47).
 */
export function SiteSwitcher({
  activeSiteId,
  sites,
  isLoadingSites,
  isSwitching,
  onSwitch,
  collapsed = false,
}: SiteSwitcherProps) {
  const activeSite = sites.find((site) => site.id === activeSiteId) ?? null

  if (sites.length === 0) {
    return null
  }

  // Exactly one grant and it is already active: hide the normal chrome.
  if (sites.length === 1 && activeSite) {
    return null
  }

  const recoverySite = sites.length === 1 ? sites[0] : null

  const recoveryPrompt = !activeSite
    ? recoverySite
      ? {
          title: 'No active site',
          actionLabel: `Activate ${recoverySite.name}`,
          onAction: () => onSwitch(recoverySite.id),
        }
      : { title: 'No active site', actionLabel: null, onAction: null }
    : null

  if (collapsed) {
    if (!activeSite && sites.length > 1) {
      return (
        <div className="px-2 pt-3">
          <SitePicker
            activeSiteId={activeSiteId}
            sites={sites}
            isLoadingSites={isLoadingSites}
            isSwitching={isSwitching}
            onSwitch={onSwitch}
            compact
          />
        </div>
      )
    }
    if (recoveryPrompt?.actionLabel) {
      return (
        <div className="px-2 pt-3">
          <button
            type="button"
            onClick={recoveryPrompt.onAction ?? undefined}
            disabled={isSwitching}
            className="flex h-10 w-full items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300"
            title={recoveryPrompt.actionLabel}
            aria-label={recoveryPrompt.actionLabel}
          >
            {isSwitching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MapPin className="h-4 w-4" />
            )}
          </button>
        </div>
      )
    }
    return (
      <div className="px-2 pt-3">
        <div
          className="flex h-10 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300"
          title={activeSite?.name ?? 'Select site'}
          aria-label={activeSite?.name ?? 'Select site'}
        >
          <MapPin className="h-4 w-4" />
        </div>
      </div>
    )
  }

  return (
    <section className="px-3 pt-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        {recoveryPrompt ? (
          recoverySite ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400">
                  {recoveryPrompt.title}
                </p>
                {recoveryPrompt.actionLabel ? (
                  <p className="truncate text-xs text-slate-400">
                    Operational views need a site selection.
                  </p>
                ) : null}
              </div>
              {recoveryPrompt.actionLabel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={recoveryPrompt.onAction ?? undefined}
                  disabled={isSwitching}
                  className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
                >
                  {isSwitching ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {recoveryPrompt.actionLabel}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400">
                {recoveryPrompt.title}
              </p>
              <p className="truncate text-xs text-slate-400">
                Operational views need a site selection.
              </p>
              <SitePicker
                activeSiteId={activeSiteId}
                sites={sites}
                isLoadingSites={isLoadingSites}
                isSwitching={isSwitching}
                onSwitch={onSwitch}
              />
            </div>
          )
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Current Site
            </p>
            <div className="mt-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
              <SitePicker
                activeSiteId={activeSiteId}
                sites={sites}
                isLoadingSites={isLoadingSites}
                isSwitching={isSwitching}
                onSwitch={onSwitch}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
