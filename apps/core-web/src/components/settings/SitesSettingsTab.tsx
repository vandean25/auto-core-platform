import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useTenantMembers } from '@/api/tenant-members'
import {
  useAddSiteMembership,
  useAdminSites,
  useRemoveSiteMembership,
  useSiteMemberships,
} from '@/api/site-admin'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function memberLabel(member: {
  email: string
  firstName?: string | null
  lastName?: string | null
}) {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim()
  return fullName ? `${fullName} (${member.email})` : member.email
}

export function SitesSettingsTab() {
  const { t } = useTranslation('settings')
  const { data: sites, isLoading: areSitesLoading } = useAdminSites(true)
  const { data: tenantMembers } = useTenantMembers({ includeInactive: false, limit: 100 })
  const [selectedSiteId, setSelectedSiteId] = React.useState<string | null>(null)
  const { data: memberships, isLoading: areMembershipsLoading } = useSiteMemberships(selectedSiteId)
  const addMembership = useAddSiteMembership()
  const removeMembership = useRemoveSiteMembership()
  const [userToAdd, setUserToAdd] = React.useState('')

  React.useEffect(() => {
    if (!selectedSiteId && sites?.length) {
      setSelectedSiteId(sites[0].id)
    }
  }, [selectedSiteId, sites])

  const selectedSite = sites?.find((site) => site.id === selectedSiteId) ?? null
  const memberIdsOnSite = new Set((memberships ?? []).map((membership) => membership.user_id))
  const availableMembers = (tenantMembers?.data ?? []).filter(
    (member) => member.isActive && !memberIdsOnSite.has(member.userId),
  )

  const handleAddMembership = async () => {
    if (!selectedSiteId || !userToAdd) return

    try {
      await addMembership.mutateAsync({ siteId: selectedSiteId, userId: userToAdd })
      toast.success(t('sites.toast.added'))
      setUserToAdd('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('sites.toast.addFailed'))
    }
  }

  const handleRemoveMembership = async (userId: string) => {
    if (!selectedSiteId) return

    try {
      await removeMembership.mutateAsync({ siteId: selectedSiteId, userId })
      toast.success(t('sites.toast.removed'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('sites.toast.removeFailed'))
    }
  }

  if (areSitesLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('sites.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('sites.description')}
        </p>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sites.columns.code')}</TableHead>
              <TableHead>{t('sites.columns.name')}</TableHead>
              <TableHead>{t('sites.columns.legalEntity')}</TableHead>
              <TableHead>{t('sites.columns.status')}</TableHead>
              <TableHead>{t('sites.columns.members')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sites ?? []).map((site) => (
              <TableRow
                key={site.id}
                data-state={site.id === selectedSiteId ? 'selected' : undefined}
                className={site.id === selectedSiteId ? 'bg-slate-50' : undefined}
                onClick={() => setSelectedSiteId(site.id)}
              >
                <TableCell className="font-mono text-sm">{site.code}</TableCell>
                <TableCell className="font-medium">{site.name}</TableCell>
                <TableCell>{site.legal_entity?.name ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={site.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell>{site._count?.memberships ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selectedSite ? (
        <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
          <div>
            <h4 className="font-medium">
              {t('sites.memberships.title', { name: selectedSite.name })}
              <span className="ml-2 font-mono text-sm text-slate-500">{selectedSite.code}</span>
            </h4>
            <p className="text-sm text-muted-foreground">
              {t('sites.memberships.description')}
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="site-member-add">{t('sites.memberships.addLabel')}</Label>
              <Select value={userToAdd} onValueChange={setUserToAdd}>
                <SelectTrigger id="site-member-add">
                  <SelectValue placeholder={t('sites.memberships.addPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {availableMembers.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {memberLabel(member)} — {member.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={!userToAdd || addMembership.isPending}
              onClick={() => void handleAddMembership()}
            >
              {t('sites.memberships.addButton')}
            </Button>
          </div>

          {areMembershipsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('sites.memberships.loading')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sites.memberships.columns.user')}</TableHead>
                  <TableHead>{t('sites.memberships.columns.tenantRole')}</TableHead>
                  <TableHead className="text-right">{t('sites.memberships.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(memberships ?? []).map((membership) => (
                  <TableRow key={membership.id}>
                    <TableCell>{memberLabel(membership.user)}</TableCell>
                    <TableCell>{membership.tenantMember.role}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={removeMembership.isPending}
                        onClick={() => void handleRemoveMembership(membership.user_id)}
                      >
                        {t('sites.memberships.remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}
    </div>
  )
}
