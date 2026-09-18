import * as React from 'react'
import { Loader2 } from 'lucide-react'
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
      toast.success('Site membership added')
      setUserToAdd('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add site membership')
    }
  }

  const handleRemoveMembership = async (userId: string) => {
    if (!selectedSiteId) return

    try {
      await removeMembership.mutateAsync({ siteId: selectedSiteId, userId })
      toast.success('Site membership removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove site membership')
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
        <h3 className="text-lg font-medium">Sites</h3>
        <p className="text-sm text-muted-foreground">
          Operational shop locations. Site memberships control who can activate each site in the sidebar switcher.
        </p>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Legal Entity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Members</TableHead>
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
              Memberships for {selectedSite.name}
              <span className="ml-2 font-mono text-sm text-slate-500">{selectedSite.code}</span>
            </h4>
            <p className="text-sm text-muted-foreground">
              Users need an active tenant role and a site membership before the site appears in Current Site.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="site-member-add">Add tenant member</Label>
              <Select value={userToAdd} onValueChange={setUserToAdd}>
                <SelectTrigger id="site-member-add">
                  <SelectValue placeholder="Select team member" />
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
              Add Membership
            </Button>
          </div>

          {areMembershipsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading memberships...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Tenant Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                        Remove
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
