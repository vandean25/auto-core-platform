import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'

import {
  type Employee,
  type EmployeeRole,
  useCreateEmployee,
  useDeleteEmployee,
  useEmployees,
  useUpdateEmployee,
} from '@/api/employees'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
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
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

const EMPLOYEE_ROLE_OPTIONS: EmployeeRole[] = ['MECHANIC', 'SERVICE_ADVISOR', 'PARTS_CLERK']

type EmployeeFormState = {
  name: string
  role: EmployeeRole
  sortOrder: string
}

const defaultFormState: EmployeeFormState = {
  name: '',
  role: 'MECHANIC',
  sortOrder: '0',
}

function formatRoleLabel(role: EmployeeRole) {
  return role
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function matchesEmployeeSearch(employee: Employee, term: string) {
  if (!term) return true

  const haystack = [
    employee.name,
    employee.role,
    formatRoleLabel(employee.role),
    employee.isActive ? 'active' : 'inactive',
    String(employee.sortOrder),
  ]

  return haystack.some((entry) => entry.toLowerCase().includes(term))
}

function sortEmployees(
  employees: Employee[],
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
) {
  if (!sortField) return employees

  const direction = sortDirection === 'desc' ? -1 : 1

  return [...employees].sort((left, right) => {
    if (sortField === 'name') {
      return direction * left.name.localeCompare(right.name)
    }

    if (sortField === 'role') {
      return direction * left.role.localeCompare(right.role)
    }

    if (sortField === 'isActive') {
      return direction * ((Number(left.isActive)) - (Number(right.isActive)))
    }

    if (sortField === 'sortOrder') {
      return direction * (left.sortOrder - right.sortOrder)
    }

    return 0
  })
}

export function EmployeeSettingsTab() {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

  const { data: responseData, isLoading } = useEmployees({
    includeInactive: true,
    limit: 100,
  })
  const createMutation = useCreateEmployee()
  const updateMutation = useUpdateEmployee()
  const deleteMutation = useDeleteEmployee()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [formState, setFormState] = React.useState<EmployeeFormState>(defaultFormState)

  const employees = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredEmployees = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return employees.filter((employee) => matchesEmployeeSearch(employee, term))
  }, [employees, queryParams.search])

  const sortedEmployees = React.useMemo(
    () => sortEmployees(filteredEmployees, queryParams.sortField, queryParams.sortDirection),
    [filteredEmployees, queryParams.sortDirection, queryParams.sortField],
  )

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedEmployees.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return

    setPagination((previous) => ({
      ...previous,
      pageIndex: pageCount - 1,
    }))
  }, [pageCount, queryParams.page, setPagination])

  const pageStart = (currentPage - 1) * pageSize
  const pagedEmployees = sortedEmployees.slice(pageStart, pageStart + pageSize)

  const runUpdate = React.useCallback(
    async (
      id: string,
      data: {
        name?: string
        role?: EmployeeRole
        isActive?: boolean
        sortOrder?: number
      },
      successMessage: string,
      fallbackMessage: string,
    ) => {
      try {
        await updateMutation.mutateAsync({ id, data })
        toast.success(successMessage)
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, fallbackMessage))
        throw error
      }
    },
    [updateMutation],
  )

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    const normalizedName = formState.name.trim()
    if (!normalizedName) {
      toast.error('Employee name is required')
      return
    }

    const parsedSortOrder = Number(formState.sortOrder)
    if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
      toast.error('Sort order must be a non-negative integer')
      return
    }

    try {
      await createMutation.mutateAsync({
        name: normalizedName,
        role: formState.role,
        sortOrder: parsedSortOrder,
        isActive: true,
      })

      toast.success('Employee created')
      setFormState(defaultFormState)
      setCreateOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create employee'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteMutation.mutateAsync(id)
      if (result.deleted) {
        toast.success('Employee deleted')
        return
      }

      toast.success('Employee deactivated')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete employee'))
    }
  }

  const columns = React.useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <InlineEdit
            value={row.original.name}
            onSave={async (nextName) => {
              const normalizedName = nextName.trim()
              if (!normalizedName) {
                toast.error('Employee name is required')
                throw new Error('Employee name is required')
              }

              await runUpdate(
                row.original.id,
                { name: normalizedName },
                'Employee updated',
                'Failed to update employee name',
              )
            }}
          />
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Role' />,
        cell: ({ row }) => (
          <Select
            value={row.original.role}
            onValueChange={(nextRole) => {
              void runUpdate(
                row.original.id,
                { role: nextRole as EmployeeRole },
                'Employee role updated',
                'Failed to update employee role',
              )
            }}
          >
            <SelectTrigger className='h-8 w-[180px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {formatRoleLabel(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Active' />,
        cell: ({ row }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              void runUpdate(
                row.original.id,
                { isActive: !row.original.isActive },
                row.original.isActive ? 'Employee deactivated' : 'Employee activated',
                'Failed to update employee status',
              )
            }}
          >
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Button>
        ),
      },
      {
        accessorKey: 'sortOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Sort Order' />,
        cell: ({ row }) => (
          <InlineEdit
            value={String(row.original.sortOrder)}
            onSave={async (nextSortOrder) => {
              const parsedSortOrder = Number(nextSortOrder.trim())
              if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
                toast.error('Sort order must be a non-negative integer')
                throw new Error('Sort order must be a non-negative integer')
              }

              await runUpdate(
                row.original.id,
                { sortOrder: parsedSortOrder },
                'Employee sort order updated',
                'Failed to update employee sort order',
              )
            }}
          />
        ),
      },
    ],
    [runUpdate],
  )

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-medium'>Employees</h3>
          <p className='text-sm text-muted-foreground'>Manage workshop personnel available for assignments.</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>+ Employee</Button>
      </div>

      <DataTable
        columns={columns}
        data={pagedEmployees}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search employees...'
        setPagination={setPagination}
        getRowContextActions={(row) => [
          {
            label: 'Delete',
            destructive: true,
            onClick: () => {
              void handleDelete(row.id)
            },
          },
        ]}
        {...tableState}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Employee</DialogTitle>
            <DialogDescription>Add a workshop team member.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='employee-name'>Name</Label>
              <Input
                id='employee-name'
                value={formState.name}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, name: event.target.value }))
                }}
                placeholder='Employee name'
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-role'>Role</Label>
              <Select
                value={formState.role}
                onValueChange={(nextRole) => {
                  setFormState((previous) => ({ ...previous, role: nextRole as EmployeeRole }))
                }}
              >
                <SelectTrigger id='employee-role'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {formatRoleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-sort-order'>Sort Order</Label>
              <Input
                id='employee-sort-order'
                type='number'
                min={0}
                step={1}
                value={formState.sortOrder}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, sortOrder: event.target.value }))
                }}
              />
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
