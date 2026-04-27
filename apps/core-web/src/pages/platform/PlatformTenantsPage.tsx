import * as React from 'react'
import { Navigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'

import { useAuthSession } from '@/api/auth-session'
import {
  type PlatformTenant,
  type TenantPlan,
  useCreatePlatformTenant,
  usePlatformTenants,
  useUpdatePlatformTenant,
} from '@/api/platform-tenants'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
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
import { PageLoader } from '@/components/ui/PageLoader'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

const TENANT_PLAN_OPTIONS = ['STANDARD', 'PREMIUM', 'ENTERPRISE'] as const

type TenantFormState = {
  name: string
  slug: string
  plan: TenantPlan
  isActive: 'ACTIVE' | 'INACTIVE'
}

const defaultTenantFormState: TenantFormState = {
  name: '',
  slug: '',
  plan: 'STANDARD',
  isActive: 'ACTIVE',
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function matchesTenantSearch(tenant: PlatformTenant, term: string) {
  if (!term) return true

  const haystack = [
    tenant.name,
    tenant.slug,
    tenant.plan,
    String(tenant.memberCount),
    tenant.isActive ? 'active' : 'inactive',
  ]

  return haystack.some((entry) => entry.toLowerCase().includes(term))
}

function sortTenants(
  tenants: PlatformTenant[],
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
) {
  if (!sortField) return tenants

  const direction = sortDirection === 'desc' ? -1 : 1

  return [...tenants].sort((left, right) => {
    if (sortField === 'name') {
      return direction * left.name.localeCompare(right.name)
    }

    if (sortField === 'slug') {
      return direction * left.slug.localeCompare(right.slug)
    }

    if (sortField === 'plan') {
      return direction * left.plan.localeCompare(right.plan)
    }

    if (sortField === 'memberCount') {
      return direction * (left.memberCount - right.memberCount)
    }

    if (sortField === 'isActive') {
      return direction * (Number(left.isActive) - Number(right.isActive))
    }

    return 0
  })
}

function toEditFormState(tenant: PlatformTenant): TenantFormState {
  return {
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    isActive: tenant.isActive ? 'ACTIVE' : 'INACTIVE',
  }
}

export default function PlatformTenantsPage() {
  const sessionQuery = useAuthSession()
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, error, isLoading, refetch } = usePlatformTenants({
    includeInactive: true,
    limit: 100,
  })
  const createMutation = useCreatePlatformTenant()
  const updateMutation = useUpdatePlatformTenant()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createFormState, setCreateFormState] = React.useState<TenantFormState>(defaultTenantFormState)
  const [selectedTenant, setSelectedTenant] = React.useState<PlatformTenant | null>(null)
  const [editFormState, setEditFormState] = React.useState<TenantFormState>(defaultTenantFormState)
  const [sheetOpen, setSheetOpen] = React.useState(false)

  const tenants = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredTenants = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return tenants.filter((tenant) => matchesTenantSearch(tenant, term))
  }, [tenants, queryParams.search])

  const sortedTenants = React.useMemo(
    () => sortTenants(filteredTenants, queryParams.sortField, queryParams.sortDirection),
    [filteredTenants, queryParams.sortDirection, queryParams.sortField],
  )

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedTenants.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return

    setPagination((previous) => ({
      ...previous,
      pageIndex: pageCount - 1,
    }))
  }, [pageCount, queryParams.page, setPagination])

  const pageStart = (currentPage - 1) * pageSize
  const pagedTenants = sortedTenants.slice(pageStart, pageStart + pageSize)

  const columns = React.useMemo<ColumnDef<PlatformTenant>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <div>
            <div className='font-medium'>{row.original.name}</div>
            <div className='text-xs text-slate-500'>{row.original.slug}</div>
          </div>
        ),
      },
      {
        accessorKey: 'plan',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Plan' />,
      },
      {
        accessorKey: 'memberCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Members' />,
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

  if (sessionQuery.isLoading) {
    return <PageLoader />
  }

  if (sessionQuery.data?.platformRole !== 'SUPER_ADMIN') {
    return <Navigate to='/dashboard' replace />
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    try {
      await createMutation.mutateAsync({
        name: createFormState.name.trim(),
        slug: createFormState.slug.trim().toLowerCase(),
        plan: createFormState.plan,
      })
      toast.success('Tenant created')
      setCreateFormState(defaultTenantFormState)
      setCreateOpen(false)
    } catch (createError: unknown) {
      toast.error(getErrorMessage(createError, 'Failed to create tenant'))
    }
  }

  const handleSaveTenant = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTenant) return

    try {
      const updatedTenant = await updateMutation.mutateAsync({
        id: selectedTenant.id,
        data: {
          name: editFormState.name.trim(),
          slug: editFormState.slug.trim().toLowerCase(),
          plan: editFormState.plan,
          isActive: editFormState.isActive === 'ACTIVE',
        },
      })

      toast.success('Tenant updated')
      setSelectedTenant(updatedTenant)
      setEditFormState(toEditFormState(updatedTenant))
    } catch (updateError: unknown) {
      toast.error(getErrorMessage(updateError, 'Failed to update tenant'))
    }
  }

  return (
    <div className='w-full max-w-7xl mx-auto p-6 space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Tenants</h1>
          <p className='text-slate-500'>Manage platform tenants, plans, and onboarding state.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          + Tenant
        </Button>
      </div>

      {error ? (
        <div className='rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'>
          <div className='flex items-center justify-between gap-4'>
            <span>{getErrorMessage(error, 'Failed to load tenants')}</span>
            <Button variant='outline' size='sm' onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={pagedTenants}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search tenants...'
        setPagination={setPagination}
        onRowClick={(tenant) => {
          setSelectedTenant(tenant)
          setEditFormState(toEditFormState(tenant))
          setSheetOpen(true)
        }}
        {...tableState}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>
              This creates the tenant foundation and its default finance settings.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='tenant-name'>Name</Label>
              <Input
                id='tenant-name'
                value={createFormState.name}
                onChange={(event) => setCreateFormState((previous) => ({
                  ...previous,
                  name: event.target.value,
                }))}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='tenant-slug'>Slug</Label>
              <Input
                id='tenant-slug'
                value={createFormState.slug}
                onChange={(event) => setCreateFormState((previous) => ({
                  ...previous,
                  slug: event.target.value,
                }))}
                placeholder='north-branch'
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='tenant-plan'>Plan</Label>
              <Select
                value={createFormState.plan}
                onValueChange={(nextPlan) => setCreateFormState((previous) => ({
                  ...previous,
                  plan: nextPlan as TenantPlan,
                }))}
              >
                <SelectTrigger id='tenant-plan'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANT_PLAN_OPTIONS.map((plan) => (
                    <SelectItem key={plan} value={plan}>
                      {plan}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type='submit' disabled={createMutation.isPending}>
                Create Tenant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='w-full sm:max-w-xl'>
          <SheetHeader className='mb-6'>
            <SheetTitle>Tenant Details</SheetTitle>
            <SheetDescription>
              Update platform metadata and activation state for this tenant.
            </SheetDescription>
          </SheetHeader>

          {selectedTenant ? (
            <form onSubmit={handleSaveTenant} className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='tenant-edit-name'>Name</Label>
                <Input
                  id='tenant-edit-name'
                  value={editFormState.name}
                  onChange={(event) => setEditFormState((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))}
                  required
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='tenant-edit-slug'>Slug</Label>
                <Input
                  id='tenant-edit-slug'
                  value={editFormState.slug}
                  onChange={(event) => setEditFormState((previous) => ({
                    ...previous,
                    slug: event.target.value,
                  }))}
                  required
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='tenant-edit-plan'>Plan</Label>
                <Select
                  value={editFormState.plan}
                  onValueChange={(nextPlan) => setEditFormState((previous) => ({
                    ...previous,
                    plan: nextPlan as TenantPlan,
                  }))}
                >
                  <SelectTrigger id='tenant-edit-plan'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TENANT_PLAN_OPTIONS.map((plan) => (
                      <SelectItem key={plan} value={plan}>
                        {plan}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='tenant-edit-status'>Status</Label>
                <Select
                  value={editFormState.isActive}
                  onValueChange={(nextStatus) => setEditFormState((previous) => ({
                    ...previous,
                    isActive: nextStatus as 'ACTIVE' | 'INACTIVE',
                  }))}
                >
                  <SelectTrigger id='tenant-edit-status'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='ACTIVE'>Active</SelectItem>
                    <SelectItem value='INACTIVE'>Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600'>
                Current members: {selectedTenant.memberCount}
              </div>

              <SheetFooter>
                <Button type='submit' disabled={updateMutation.isPending}>
                  Save Tenant
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}