import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { z } from 'zod'
import { toast } from 'sonner'

import {
  type TenantMember,
  type TenantMemberRole,
  useInviteTenantMember,
  useTenantMembers,
  useUpdateTenantMember,
} from '@/api/tenant-members'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

const TEAM_ROLE_OPTIONS = ['OWNER', 'ADMIN', 'TECH', 'SALES'] as const
const TEAM_ROLE_SCHEMA = z.enum(TEAM_ROLE_OPTIONS)

type InviteMemberFormState = {
  email: string
  role: TenantMemberRole
}

const defaultInviteMemberFormState: InviteMemberFormState = {
  email: '',
  role: 'TECH',
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function getDisplayName(member: TenantMember) {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim()
  return fullName || member.email
}

function matchesMemberSearch(member: TenantMember, term: string) {
  if (!term) return true

  const haystack = [
    member.email,
    member.firstName ?? '',
    member.lastName ?? '',
    getDisplayName(member),
    member.role,
    member.isActive ? 'active' : 'inactive',
  ]

  return haystack.some((entry) => entry.toLowerCase().includes(term))
}

function sortMembers(
  members: TenantMember[],
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
) {
  if (!sortField) return members

  const direction = sortDirection === 'desc' ? -1 : 1

  return [...members].sort((left, right) => {
    if (sortField === 'email') {
      return direction * left.email.localeCompare(right.email)
    }

    if (sortField === 'role') {
      return direction * left.role.localeCompare(right.role)
    }

    if (sortField === 'isActive') {
      return direction * (Number(left.isActive) - Number(right.isActive))
    }

    if (sortField === 'name') {
      return direction * getDisplayName(left).localeCompare(getDisplayName(right))
    }

    return 0
  })
}

export function TeamSettingsTab() {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, error, isLoading, refetch } = useTenantMembers({
    includeInactive: true,
    limit: 100,
  })
  const inviteMutation = useInviteTenantMember()
  const updateMutation = useUpdateTenantMember()

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [inviteFormState, setInviteFormState] = React.useState<InviteMemberFormState>(defaultInviteMemberFormState)
  const [selectedMember, setSelectedMember] = React.useState<TenantMember | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)

  const members = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredMembers = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return members.filter((member) => matchesMemberSearch(member, term))
  }, [members, queryParams.search])

  const sortedMembers = React.useMemo(
    () => sortMembers(filteredMembers, queryParams.sortField, queryParams.sortDirection),
    [filteredMembers, queryParams.sortDirection, queryParams.sortField],
  )

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedMembers.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return

    setPagination((previous) => ({
      ...previous,
      pageIndex: pageCount - 1,
    }))
  }, [pageCount, queryParams.page, setPagination])

  const pageStart = (currentPage - 1) * pageSize
  const pagedMembers = sortedMembers.slice(pageStart, pageStart + pageSize)

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault()

    try {
      await inviteMutation.mutateAsync({
        email: inviteFormState.email.trim().toLowerCase(),
        role: inviteFormState.role,
      })
      toast.success('Member invited')
      setInviteFormState(defaultInviteMemberFormState)
      setInviteOpen(false)
    } catch (inviteError: unknown) {
      toast.error(getErrorMessage(inviteError, 'Failed to invite team member'))
    }
  }

  const handleToggleActive = async (member: TenantMember) => {
    try {
      const updatedMember = await updateMutation.mutateAsync({
        id: member.id,
        data: { isActive: !member.isActive },
      })

      toast.success(updatedMember.isActive ? 'Member reactivated' : 'Member deactivated')
      setSelectedMember(updatedMember)
    } catch (updateError: unknown) {
      toast.error(getErrorMessage(updateError, 'Failed to update member status'))
    }
  }

  const columns = React.useMemo<ColumnDef<TenantMember>[]>(
    () => [
      {
        id: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <div>
            <div className='font-medium'>{getDisplayName(row.original)}</div>
            <div className='text-xs text-slate-500'>{row.original.email}</div>
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Role' />,
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'} />
        ),
      },
    ],
    [],
  )

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-medium'>Team</h3>
          <p className='text-sm text-slate-500'>Invite tenant users and manage their membership roles.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          + Member
        </Button>
      </div>

      {error ? (
        <div className='rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'>
          <div className='flex items-center justify-between gap-4'>
            <span>{getErrorMessage(error, 'Failed to load team members')}</span>
            <Button variant='outline' size='sm' onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={pagedMembers}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search team members...'
        setPagination={setPagination}
        onRowClick={(member) => {
          setSelectedMember(member)
          setSheetOpen(true)
        }}
        {...tableState}
      />

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Create or reactivate a tenant membership and synchronize the user claims immediately.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInvite} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='team-invite-email'>Email</Label>
              <Input
                id='team-invite-email'
                type='email'
                value={inviteFormState.email}
                onChange={(event) => setInviteFormState((previous) => ({
                  ...previous,
                  email: event.target.value,
                }))}
                placeholder='tech@autocore.com'
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='team-invite-role'>Role</Label>
              <Select
                value={inviteFormState.role}
                onValueChange={(nextRole) => setInviteFormState((previous) => ({
                  ...previous,
                  role: nextRole as TenantMemberRole,
                }))}
              >
                <SelectTrigger id='team-invite-role'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type='submit' disabled={inviteMutation.isPending}>
                Invite Member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='w-full sm:max-w-xl'>
          <SheetHeader className='mb-6'>
            <SheetTitle>Member Details</SheetTitle>
            <SheetDescription>
              Update a role or deactivate access. Security-sensitive changes force a claims refresh.
            </SheetDescription>
          </SheetHeader>

          {selectedMember ? (
            <div className='space-y-6'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-slate-900'>{getDisplayName(selectedMember)}</p>
                <p className='text-sm text-slate-500'>{selectedMember.email}</p>
              </div>

              <div className='space-y-2'>
                <Label>Role</Label>
                <InlineEdit
                  value={selectedMember.role}
                  schema={TEAM_ROLE_SCHEMA}
                  ariaLabel='Tenant member role'
                  onSave={async (nextRole) => {
                    const normalizedRole = nextRole.trim().toUpperCase() as TenantMemberRole
                    try {
                      const updatedMember = await updateMutation.mutateAsync({
                        id: selectedMember.id,
                        data: { role: normalizedRole },
                      })
                      setSelectedMember(updatedMember)
                      toast.success('Member role updated')
                    } catch (updateError: unknown) {
                      toast.error(getErrorMessage(updateError, 'Failed to update member role'))
                      throw updateError
                    }
                  }}
                />
                <p className='text-xs text-slate-500'>Allowed values: OWNER, ADMIN, TECH, SALES.</p>
              </div>

              <div className='space-y-2'>
                <Label>Status</Label>
                <StatusBadge status={selectedMember.isActive ? 'ACTIVE' : 'INACTIVE'} />
              </div>

              <SheetFooter>
                <Button
                  variant={selectedMember.isActive ? 'destructive' : 'default'}
                  onClick={() => void handleToggleActive(selectedMember)}
                  disabled={updateMutation.isPending}
                >
                  {selectedMember.isActive ? 'Deactivate Member' : 'Reactivate Member'}
                </Button>
              </SheetFooter>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}