import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import type { components } from '@/api/generated/openapi'
import {
  type Employee,
  type EmployeeRole,
  useCreateEmployee,
  useDeleteEmployee,
  useEmployees,
  useUpdateEmployee,
} from '@/api/employees'
import { usePatchLeaveBalance } from '@/api/hr'
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
import { SOURCE_LANGUAGE_OPTIONS } from '@/constants/voice-languages'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

const EMPLOYEE_ROLE_OPTIONS: EmployeeRole[] = ['MECHANIC', 'SERVICE_ADVISOR', 'PARTS_CLERK']
const MIN_LEAVE_DAYS = 0
const MAX_LEAVE_DAYS = 365
type TenantMemberRole = components['schemas']['TenantMemberRole']

type EmployeeFormState = {
  name: string
  role: EmployeeRole
  sortOrder: string
  motherLanguageCode: string
  hiredOn: string
  annualLeaveDays: string
}

type EmployeeTableProps = {
  activeRole?: TenantMemberRole | null
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
}

type EditableFieldProps = {
  ariaLabel: string
  canEdit: boolean
  initialValue: string
  onSave: (value: string) => Promise<void>
}

const defaultFormState: EmployeeFormState = {
  name: '',
  role: 'MECHANIC',
  sortOrder: '0',
  motherLanguageCode: '',
  hiredOn: '',
  annualLeaveDays: '25',
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

function getLanguageLabel(code: string | null | undefined) {
  if (!code) return 'Default (target language)'
  const option = SOURCE_LANGUAGE_OPTIONS.find((item) => item.value === code)
  return option ? option.label : code
}

function canEditHrFields(activeRole?: TenantMemberRole | null) {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

function matchesEmployeeSearch(employee: Employee, term: string) {
  if (!term) return true

  const haystack = [
    employee.name,
    employee.role,
    formatRoleLabel(employee.role),
    employee.isActive ? 'active' : 'inactive',
    String(employee.sortOrder),
    employee.motherLanguageCode ?? '',
    getLanguageLabel(employee.motherLanguageCode),
    employee.hiredOn ?? 'Not set',
    String(employee.annualLeaveDays),
    String(employee.remainingLeaveDays),
    employee.userId ?? '',
    employee.userId ? 'linked' : 'not linked',
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
      return direction * (Number(left.isActive) - Number(right.isActive))
    }

    if (sortField === 'sortOrder') {
      return direction * (left.sortOrder - right.sortOrder)
    }

    if (sortField === 'motherLanguageCode' || sortField === 'userId' || sortField === 'hiredOn') {
      const leftValue = left[sortField] ?? ''
      const rightValue = right[sortField] ?? ''
      return direction * leftValue.localeCompare(rightValue)
    }

    if (sortField === 'annualLeaveDays' || sortField === 'remainingLeaveDays') {
      return direction * (left[sortField] - right[sortField])
    }

    return 0
  })
}

function EditableDateField({ ariaLabel, canEdit, initialValue, onSave }: EditableFieldProps) {
  const [value, setValue] = React.useState(initialValue)
  const [isEditing, setIsEditing] = React.useState(Boolean(initialValue))
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    setValue(initialValue)
    setIsEditing(Boolean(initialValue))
  }, [initialValue])

  const commit = async () => {
    if (value === initialValue || isSaving) {
      if (!value) setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(value)
      if (!value) setIsEditing(false)
    } catch {
      setValue(initialValue)
    } finally {
      setIsSaving(false)
    }
  }

  if (!canEdit) {
    return <span>{initialValue || 'Not set'}</span>
  }

  if (!isEditing) {
    return (
      <button
        type='button'
        onClick={(event) => {
          event.stopPropagation()
          setIsEditing(true)
        }}
        className='group/inline-edit relative -mx-2 w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <span className='block pr-5 text-sm text-muted-foreground italic'>Not set</span>
        <Pencil className='pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-70' />
      </button>
    )
  }

  return (
    <div
      role='presentation'
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Input
        type='date'
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        disabled={isSaving}
        className='h-8 min-w-[145px]'
      />
    </div>
  )
}

function EditableLeaveDaysField({ ariaLabel, canEdit, initialValue, onSave }: EditableFieldProps) {
  const [value, setValue] = React.useState(initialValue)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const commit = async () => {
    if (value === initialValue || isSaving) return

    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue) || parsedValue < MIN_LEAVE_DAYS || parsedValue > MAX_LEAVE_DAYS) {
      toast.error(`Leave days must be an integer between ${MIN_LEAVE_DAYS} and ${MAX_LEAVE_DAYS}`)
      setValue(initialValue)
      return
    }

    setIsSaving(true)
    try {
      await onSave(String(parsedValue))
    } catch {
      setValue(initialValue)
    } finally {
      setIsSaving(false)
    }
  }

  if (!canEdit) {
    return <span>{initialValue}</span>
  }

  return (
    <div
      role='presentation'
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Input
        type='number'
        min={MIN_LEAVE_DAYS}
        max={MAX_LEAVE_DAYS}
        step={1}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        disabled={isSaving}
        className='h-8 w-[105px]'
      />
    </div>
  )
}

export function EmployeeTable({ activeRole, createOpen, onCreateOpenChange }: EmployeeTableProps) {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useEmployees({
    includeInactive: true,
    limit: 100,
  })
  const createMutation = useCreateEmployee()
  const updateMutation = useUpdateEmployee()
  const deleteMutation = useDeleteEmployee()
  const patchLeaveBalanceMutation = usePatchLeaveBalance()
  const [formState, setFormState] = React.useState<EmployeeFormState>(defaultFormState)
  const [selectedEmployee, setSelectedEmployee] = React.useState<Employee | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [carryoverDays, setCarryoverDays] = React.useState('0')

  const hasHrEditAccess = canEditHrFields(activeRole)
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
        motherLanguageCode?: string | null
        hiredOn?: string | null
        annualLeaveDays?: number
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

    let parsedAnnualLeaveDays: number | undefined
    if (hasHrEditAccess) {
      parsedAnnualLeaveDays = Number(formState.annualLeaveDays)
      if (
        !Number.isInteger(parsedAnnualLeaveDays) ||
        parsedAnnualLeaveDays < MIN_LEAVE_DAYS ||
        parsedAnnualLeaveDays > MAX_LEAVE_DAYS
      ) {
        toast.error(`Leave days must be an integer between ${MIN_LEAVE_DAYS} and ${MAX_LEAVE_DAYS}`)
        return
      }
    }

    try {
      await createMutation.mutateAsync({
        name: normalizedName,
        role: formState.role,
        sortOrder: parsedSortOrder,
        isActive: true,
        motherLanguageCode: formState.motherLanguageCode || null,
        ...(hasHrEditAccess
          ? {
              hiredOn: formState.hiredOn || null,
              annualLeaveDays: parsedAnnualLeaveDays,
            }
          : {}),
      })

      toast.success('Employee created')
      setFormState(defaultFormState)
      onCreateOpenChange(false)
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

  const handleSaveCarryover = async () => {
    if (!selectedEmployee || !hasHrEditAccess || !carryoverDays.trim()) return

    const parsedCarryoverDays = Number(carryoverDays)
    if (
      !Number.isInteger(parsedCarryoverDays) ||
      parsedCarryoverDays < MIN_LEAVE_DAYS ||
      parsedCarryoverDays > MAX_LEAVE_DAYS
    ) {
      toast.error(`Carryover days must be an integer between ${MIN_LEAVE_DAYS} and ${MAX_LEAVE_DAYS}`)
      return
    }
    if (parsedCarryoverDays === selectedEmployee.carryoverDays) return

    try {
      const updatedBalance = await patchLeaveBalanceMutation.mutateAsync({
        employeeId: selectedEmployee.id,
        data: {
          year: selectedEmployee.leaveBalanceYear,
          carryoverDays: parsedCarryoverDays,
        },
      })
      const carryoverDelta = updatedBalance.carryoverDays - selectedEmployee.carryoverDays
      setSelectedEmployee((current) =>
        current?.id === selectedEmployee.id
          ? {
              ...current,
              carryoverDays: updatedBalance.carryoverDays,
              leaveBalanceYear: updatedBalance.year,
              remainingLeaveDays: current.remainingLeaveDays + carryoverDelta,
            }
          : current,
      )
      setCarryoverDays(String(updatedBalance.carryoverDays))
      toast.success('Leave carryover updated')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update leave carryover'))
    }
  }

  const columns = React.useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <div
            role='presentation'
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
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
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Role' />,
        cell: ({ row }) => (
          <div
            role='presentation'
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
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
          </div>
        ),
      },
      {
        accessorKey: 'motherLanguageCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Mother Language' />,
        cell: ({ row }) => (
          <div
            role='presentation'
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Select
              value={row.original.motherLanguageCode ?? '__DEFAULT__'}
              onValueChange={(nextLanguageCode) => {
                void runUpdate(
                  row.original.id,
                  {
                    motherLanguageCode:
                      nextLanguageCode === '__DEFAULT__' ? null : nextLanguageCode,
                  },
                  'Employee language updated',
                  'Failed to update employee language',
                )
              }}
            >
              <SelectTrigger className='h-8 w-[250px]'>
                <SelectValue>{getLanguageLabel(row.original.motherLanguageCode)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='__DEFAULT__'>Default (target language)</SelectItem>
                {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Active' />,
        cell: ({ row }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={(event) => {
              event.stopPropagation()
              void runUpdate(
                row.original.id,
                { isActive: !row.original.isActive },
                row.original.isActive ? 'Employee deactivated' : 'Employee activated',
                'Failed to update employee status',
              )
            }}
          >
            <StatusBadge status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'} />
          </Button>
        ),
      },
      {
        accessorKey: 'sortOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Sort Order' />,
        cell: ({ row }) => (
          <div
            role='presentation'
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
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
          </div>
        ),
      },
      {
        accessorKey: 'hiredOn',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Hire date' />,
        cell: ({ row }) => (
          <EditableDateField
            ariaLabel={`Hire date for ${row.original.name}`}
            canEdit={hasHrEditAccess}
            initialValue={row.original.hiredOn ?? ''}
            onSave={(hiredOn) =>
              runUpdate(
                row.original.id,
                { hiredOn: hiredOn || null },
                'Employee hire date updated',
                'Failed to update employee hire date',
              )}
          />
        ),
      },
      {
        accessorKey: 'annualLeaveDays',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Leave days' />,
        cell: ({ row }) => (
          <EditableLeaveDaysField
            ariaLabel={`Annual leave days for ${row.original.name}`}
            canEdit={hasHrEditAccess}
            initialValue={String(row.original.annualLeaveDays)}
            onSave={(annualLeaveDays) =>
              runUpdate(
                row.original.id,
                { annualLeaveDays: Number(annualLeaveDays) },
                'Employee leave allowance updated',
                'Failed to update employee leave allowance',
              )}
          />
        ),
      },
      {
        accessorKey: 'remainingLeaveDays',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Remaining' />,
        cell: ({ row }) => <span>{row.original.remainingLeaveDays}</span>,
      },
      {
        accessorKey: 'userId',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Login' />,
        cell: ({ row }) => (
          <span className='font-mono text-xs'>{row.original.userId ?? 'Not linked'}</span>
        ),
      },
    ],
    [hasHrEditAccess, runUpdate],
  )

  return (
    <div className='space-y-4' data-testid='employee-table'>
      <DataTable
        columns={columns}
        data={pagedEmployees}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search employees...'
        setPagination={setPagination}
        onRowClick={(employee) => {
          setSelectedEmployee(employee)
          setCarryoverDays(String(employee.carryoverDays))
          setSheetOpen(true)
        }}
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

      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
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

            <div className='space-y-2'>
              <Label htmlFor='employee-mother-language'>Mother Language</Label>
              <Select
                value={formState.motherLanguageCode || '__DEFAULT__'}
                onValueChange={(nextLanguageCode) => {
                  setFormState((previous) => ({
                    ...previous,
                    motherLanguageCode:
                      nextLanguageCode === '__DEFAULT__' ? '' : nextLanguageCode,
                  }))
                }}
              >
                <SelectTrigger id='employee-mother-language'>
                  <SelectValue placeholder='Default (target language)' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='__DEFAULT__'>Default (target language)</SelectItem>
                  {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-hired-on'>Hire date</Label>
              <Input
                id='employee-hired-on'
                type='date'
                value={formState.hiredOn}
                disabled={!hasHrEditAccess}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, hiredOn: event.target.value }))
                }}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-annual-leave-days'>Leave days</Label>
              <Input
                id='employee-annual-leave-days'
                type='number'
                min={MIN_LEAVE_DAYS}
                max={MAX_LEAVE_DAYS}
                step={1}
                value={formState.annualLeaveDays}
                disabled={!hasHrEditAccess}
                onChange={(event) => {
                  setFormState((previous) => ({
                    ...previous,
                    annualLeaveDays: event.target.value,
                  }))
                }}
              />
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => onCreateOpenChange(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-xl'>
          <SheetHeader className='mb-6'>
            <SheetTitle>Employee Details</SheetTitle>
            <SheetDescription>Review roster and leave information.</SheetDescription>
          </SheetHeader>

          {selectedEmployee ? (
            <div className='space-y-6' data-testid='employee-detail-sheet'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-slate-900'>{selectedEmployee.name}</p>
                <p className='text-sm text-slate-500'>{formatRoleLabel(selectedEmployee.role)}</p>
              </div>

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label>Hire date</Label>
                  <p className='text-sm'>{selectedEmployee.hiredOn ?? 'Not set'}</p>
                </div>
                <div className='space-y-1'>
                  <Label>Leave days</Label>
                  <p className='text-sm'>{selectedEmployee.annualLeaveDays}</p>
                </div>
                <div className='space-y-1'>
                  <Label>Remaining</Label>
                  <p className='text-sm'>{selectedEmployee.remainingLeaveDays}</p>
                </div>
                <div className='space-y-1'>
                  <Label>Login</Label>
                  <p className='break-all font-mono text-xs'>{selectedEmployee.userId ?? 'Not linked'}</p>
                </div>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='employee-carryover-days'>Carryover this year</Label>
                <Input
                  id='employee-carryover-days'
                  type='number'
                  min={MIN_LEAVE_DAYS}
                  max={MAX_LEAVE_DAYS}
                  step={1}
                  value={carryoverDays}
                  aria-label='Carryover this year'
                  disabled={!hasHrEditAccess || patchLeaveBalanceMutation.isPending}
                  onChange={(event) => setCarryoverDays(event.target.value)}
                />
              </div>

              {hasHrEditAccess ? (
                <SheetFooter>
                  <Button
                    type='button'
                    onClick={() => void handleSaveCarryover()}
                    disabled={patchLeaveBalanceMutation.isPending}
                  >
                    {patchLeaveBalanceMutation.isPending ? 'Saving...' : 'Save leave balance'}
                  </Button>
                </SheetFooter>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
