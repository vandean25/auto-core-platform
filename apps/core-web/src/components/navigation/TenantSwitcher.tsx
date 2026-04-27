import { Building2, Loader2 } from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AuthSessionMembership = components['schemas']['AuthSessionMembershipDto']
type AuthSessionTenant = components['schemas']['AuthSessionTenantDto']
type TenantMemberRole = components['schemas']['TenantMemberRole']

type TenantSwitcherProps = {
  activeTenant: AuthSessionTenant | null
  activeRole: TenantMemberRole | null
  memberships: AuthSessionMembership[]
  onSwitch: (tenantId: string) => void
  isSwitching: boolean
  collapsed?: boolean
}

export function TenantSwitcher({
  activeTenant,
  activeRole,
  memberships,
  onSwitch,
  isSwitching,
  collapsed = false,
}: TenantSwitcherProps) {
  if (!activeTenant) {
    return null
  }

  const switchableMemberships = memberships.filter((membership) => membership.tenantId !== activeTenant.id)
  const title = `${activeTenant.name} (${activeTenant.slug})`

  if (collapsed) {
    return (
      <div className="px-2 pt-3">
        <div
          className="flex h-10 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300"
          title={title}
          aria-label={title}
        >
          <Building2 className="h-4 w-4" />
        </div>
      </div>
    )
  }

  return (
    <section className="px-3 pt-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Current Tenant</p>
            <p className="truncate text-sm font-semibold text-white">{activeTenant.name}</p>
            <p className="truncate text-xs text-slate-400">{activeTenant.slug}</p>
          </div>
          {activeRole ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
              {activeRole}
            </span>
          ) : null}
        </div>

        {switchableMemberships.length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Switch Tenant</p>
            <div className="space-y-2">
              {switchableMemberships.map((membership) => (
                <Button
                  key={membership.tenantId}
                  type="button"
                  variant="ghost"
                  onClick={() => onSwitch(membership.tenantId)}
                  disabled={isSwitching}
                  aria-label={`Switch to ${membership.tenantName}`}
                  className={cn(
                    'h-auto w-full justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left text-slate-200 hover:bg-slate-800 hover:text-white',
                    isSwitching && 'cursor-wait opacity-70',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{membership.tenantName}</span>
                    <span className="block truncate text-xs text-slate-400">{membership.tenantSlug}</span>
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {isSwitching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {membership.role}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
