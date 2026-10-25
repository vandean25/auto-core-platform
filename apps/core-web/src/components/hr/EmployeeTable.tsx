import * as React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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
import { usePatchLeaveBalance, useEmployeeWorkSchedule } from '@/api/hr'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { InspectorEvidenceSection } from '@/components/hr/InspectorEvidenceSection'
import { WorkScheduleEditor } from '@/components/hr/WorkScheduleEditor'
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
import { LeaveMinutesSummary } from '@/components/hr/LeaveMinutesSummary'
import {
  defaultFormState,
  type EmployeeFormState,
  MIN_LEAVE_MINUTES,
  useEmployeeTableActions,
} from '@/components/hr/useEmployeeTableActions'
import {
  averageExpectedMinutesPerWorkday,
  FALLBACK_AVG_WORKDAY_MINUTES,
} from '@/lib/hr-leave-minutes'
import { ensureNamespaceLoaded } from '@/lib/i18n'

const EMPLOYEE_ROLE_OPTIONS: EmployeeRole[] = ['MECHANIC', 'SERVICE_ADVISOR', 'PARTS_CLERK']
type TenantMemberRole = components['schemas']['TenantMemberRole']

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

function formatRoleLabel(role: EmployeeRole, t: TFunction<'hr'>) {
  const roleKey = `employees.roles.${role}` as 'employees.roles.MECHANIC'
  return t(roleKey)
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function getLanguageLabel(code: string | null | undefined, t: TFunction<'hr'>) {
  if (!code) return t('employees.languageDefault')
  const option = SOURCE_LANGUAGE_OPTIONS.find((item) => item.value === code)
  return option ? option.label : code
}

function canEditHrFields(activeRole?: TenantMemberRole | null) {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

function matchesEmployeeSearch(employee: Employee, term: string, t: TFunction<'hr'>) {
  if (!term) return true

  const haystack = [
    employee.name,
    employee.role,
    formatRoleLabel(employee.role, t),
    employee.isActive ? t('employees.yes') : t('employees.no'),
    String(employee.sortOrder),
    employee.motherLanguageCode ?? '',
    getLanguageLabel(employee.motherLanguageCode, t),
    employee.hiredOn ?? t('employees.notSet'),
    String(employee.annualLeaveMinutes),
    String(employee.remainingLeaveMinutes),
    employee.userId ?? '',
    employee.userId ? t('employees.columns.login') : t('employees.notLinked'),
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

    if (sortField === 'annualLeaveMinutes' || sortField === 'remainingLeaveMinutes') {
      return direction * (left[sortField] - right[sortField])
    }

    return 0
  })
}

function EditableDateField({ ariaLabel, canEdit, initialValue, onSave }: EditableFieldProps) {
  const { t } = useTranslation('hr')
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
    return <span>{initialValue || t('employees.notSet')}</span>
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
        <span className='block pr-5 text-sm text-muted-foreground italic'>{t('employees.notSet')}</span>
        <Pencil className='pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity pointer-coarse:opacity-70 hover-capable:group-hover/inline-edit:opacity-70' />
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

function EditableLeaveMinutesField({ ariaLabel, canEdit, initialValue, onSave }: EditableFieldProps) {
  const { t } = useTranslation('hr')
  const [value, setValue] = React.useState(initialValue)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const commit = async () => {
    if (value === initialValue || isSaving) return

    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue) || parsedValue < MIN_LEAVE_MINUTES) {
      toast.error(t('employees.validation.leaveMinutesNonNegative'))
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
        min={MIN_LEAVE_MINUTES}
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
  const { t } = useTranslation(['hr', 'common'])
  React.useEffect(() => { void ensureNamespaceLoaded('hr') }, [])

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
  const [carryoverMinutes, setCarryoverMinutes] = React.useState('0')
  const [sheetAllowanceDays, setSheetAllowanceDays] = React.useState('')

  const sheetScheduleQuery = useEmployeeWorkSchedule(selectedEmployee?.id ?? null)
  const sheetAvgMinutes = React.useMemo(() => {
    const current = sheetScheduleQuery.data?.current
    if (!current) {
      return FALLBACK_AVG_WORKDAY_MINUTES
    }
    return averageExpectedMinutesPerWorkday(current.days)
  }, [sheetScheduleQuery.data])

  const hasHrEditAccess = canEditHrFields(activeRole)
  const employees = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredEmployees = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return employees.filter((employee) => matchesEmployeeSearch(employee, term, t))
  }, [employees, queryParams.search, t])

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

  const {
    runUpdate,
    handleCreate,
    handleDelete,
    handleSaveAllowanceDays,
    handleSaveCarryover,
  } = useEmployeeTableActions({
    createMutation,
    updateMutation,
    deleteMutation,
    patchLeaveBalanceMutation,
    hasHrEditAccess,
    selectedEmployee,
    setSelectedEmployee,
    formState,
    setFormState,
    onCreateOpenChange,
    sheetAllowanceDays,
    sheetAvgMinutes,
    carryoverMinutes,
    setCarryoverMinutes,
  })

  const columns = React.useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.name')} />,
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
                  toast.error(t('employees.validation.nameRequired'))
                  throw new Error('Employee name is required')
                }

                await runUpdate(
                  row.original.id,
                  { name: normalizedName },
                  t('employees.toast.updated'),
                  t('employees.toast.updateNameFailed'),
                )
              }}
            />
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.role')} />,
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
                  t('employees.toast.roleUpdated'),
                  t('employees.toast.updateRoleFailed'),
                )
              }}
            >
              <SelectTrigger className='h-8 w-[180px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYEE_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {formatRoleLabel(role, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
      },
      {
        accessorKey: 'motherLanguageCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.motherLanguage')} />,
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
                  t('employees.toast.languageUpdated'),
                  t('employees.toast.updateLanguageFailed'),
                )
              }}
            >
              <SelectTrigger className='h-8 w-[250px]'>
                <SelectValue>{getLanguageLabel(row.original.motherLanguageCode, t)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='__DEFAULT__'>{t('employees.languageDefault')}</SelectItem>
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
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.active')} />,
        cell: ({ row }) => (
          // eslint-disable-next-line jsx-a11y/control-has-associated-label -- accessible name is the StatusBadge text
          <Button
            variant='outline'
            size='sm'
            onClick={(event) => {
              event.stopPropagation()
              void runUpdate(
                row.original.id,
                { isActive: !row.original.isActive },
                row.original.isActive ? t('employees.toast.deactivated') : t('employees.toast.activated'),
                t('employees.toast.updateStatusFailed'),
              )
            }}
          >
            <StatusBadge status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'} />
          </Button>
        ),
      },
      {
        accessorKey: 'sortOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.sortOrder')} />,
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
                  toast.error(t('employees.validation.sortOrderNonNegative'))
                  throw new Error('Sort order must be a non-negative integer')
                }

                await runUpdate(
                  row.original.id,
                  { sortOrder: parsedSortOrder },
                  t('employees.toast.sortOrderUpdated'),
                  t('employees.toast.updateSortOrderFailed'),
                )
              }}
            />
          </div>
        ),
      },
      {
        accessorKey: 'hiredOn',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.hireDate')} />,
        cell: ({ row }) => (
          <EditableDateField
            ariaLabel={t('employees.columns.hireDate') + ' ' + row.original.name}
            canEdit={hasHrEditAccess}
            initialValue={row.original.hiredOn ?? ''}
            onSave={(hiredOn) =>
              runUpdate(
                row.original.id,
                { hiredOn: hiredOn || null },
                t('employees.toast.hireDateUpdated'),
                t('employees.toast.updateHireDateFailed'),
              )}
          />
        ),
      },
      {
        accessorKey: 'annualLeaveMinutes',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.leaveMin')} />,
        cell: ({ row }) => (
          <EditableLeaveMinutesField
            ariaLabel={t('employees.columns.leaveMin') + ' ' + row.original.name}
            canEdit={hasHrEditAccess}
            initialValue={String(row.original.annualLeaveMinutes)}
            onSave={(annualLeaveMinutes) =>
              runUpdate(
                row.original.id,
                { annualLeaveMinutes: Number(annualLeaveMinutes) },
                t('employees.toast.leaveAllowanceUpdated'),
                t('employees.toast.updateLeaveAllowanceFailed'),
              )}
          />
        ),
      },
      {
        accessorKey: 'remainingLeaveMinutes',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.remainingMin')} />,
        cell: ({ row }) => <span>{t('employees.minSuffix', { count: row.original.remainingLeaveMinutes })}</span>,
      },
      {
        accessorKey: 'userId',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('employees.columns.login')} />,
        cell: ({ row }) => (
          <span className='font-mono text-xs'>{row.original.userId ?? t('employees.notLinked')}</span>
        ),
      },
    ],
    [hasHrEditAccess, runUpdate, t],
  )

  return (
    <div className='space-y-4' data-testid='employee-table'>
      <DataTable
        columns={columns}
        data={pagedEmployees}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder={t('employees.searchPlaceholder')}
        setPagination={setPagination}
        rowBehaviour={{
          onRowClick: (employee) => {
            setSelectedEmployee(employee)
            setCarryoverMinutes(String(employee.carryoverMinutes))
            setSheetAllowanceDays('')
            setSheetOpen(true)
          },
          getRowContextActions: (row) => [
            {
              label: t('employees.delete'),
              destructive: true,
              onClick: () => {
                void handleDelete(row.id)
              },
            },
          ],
        }}
        {...tableState}
      />

      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('employees.createDialog.title')}</DialogTitle>
            <DialogDescription>{t('employees.createDialog.description')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='employee-name'>{t('employees.createDialog.name')}</Label>
              <Input
                id='employee-name'
                value={formState.name}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, name: event.target.value }))
                }}
                placeholder={t('employees.createDialog.namePlaceholder')}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-role'>{t('employees.createDialog.role')}</Label>
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
                      {formatRoleLabel(role, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-sort-order'>{t('employees.createDialog.sortOrder')}</Label>
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
              <Label htmlFor='employee-mother-language'>{t('employees.createDialog.motherLanguage')}</Label>
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
                  <SelectValue placeholder={t('employees.languageDefault')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='__DEFAULT__'>{t('employees.languageDefault')}</SelectItem>
                  {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='employee-hired-on'>{t('employees.createDialog.hireDate')}</Label>
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
              <Label htmlFor='employee-annual-leave-days'>{t('employees.createDialog.leaveDays')}</Label>
              <Input
                id='employee-annual-leave-days'
                type='number'
                min={0}
                step={0.5}
                placeholder={t('employees.createDialog.leaveDaysPlaceholder')}
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

            <div className='space-y-2'>
              <Label htmlFor='employee-annual-leave-minutes'>{t('employees.createDialog.leaveMin')}</Label>
              <Input
                id='employee-annual-leave-minutes'
                type='number'
                min={MIN_LEAVE_MINUTES}
                step={1}
                placeholder={t('employees.createDialog.leaveMinPlaceholder')}
                value={formState.annualLeaveMinutes}
                disabled={!hasHrEditAccess}
                onChange={(event) => {
                  setFormState((previous) => ({
                    ...previous,
                    annualLeaveMinutes: event.target.value,
                  }))
                }}
              />
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => onCreateOpenChange(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? t('employees.createDialog.saving') : t('employees.createDialog.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-xl'>
          <SheetHeader className='mb-6'>
            <SheetTitle>{t('employees.detailSheet.title')}</SheetTitle>
            <SheetDescription>{t('employees.detailSheet.description')}</SheetDescription>
          </SheetHeader>

          {selectedEmployee ? (
            <div className='space-y-6' data-testid='employee-detail-sheet'>
              <div className='space-y-1'>
                <p className='text-sm font-medium text-slate-900'>{selectedEmployee.name}</p>
                <p className='text-sm text-slate-500'>{formatRoleLabel(selectedEmployee.role, t)}</p>
              </div>

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label>{t('employees.detailSheet.hireDate')}</Label>
                  <p className='text-sm'>{selectedEmployee.hiredOn ?? t('employees.notSet')}</p>
                </div>
                <div className='space-y-1'>
                  <Label>{t('employees.detailSheet.leaveAllowance')}</Label>
                  <p className='text-sm'>
                    <LeaveMinutesSummary
                      minutes={selectedEmployee.annualLeaveMinutes}
                      avgMinutesPerWorkday={sheetAvgMinutes}
                    />
                  </p>
                </div>
                <div className='space-y-1'>
                  <Label>{t('employees.detailSheet.remaining')}</Label>
                  <p className='text-sm'>
                    <LeaveMinutesSummary
                      minutes={selectedEmployee.remainingLeaveMinutes}
                      avgMinutesPerWorkday={sheetAvgMinutes}
                    />
                  </p>
                </div>
                <div className='space-y-1'>
                  <Label>{t('employees.detailSheet.login')}</Label>
                  <p className='break-all font-mono text-xs'>{selectedEmployee.userId ?? t('employees.notLinked')}</p>
                </div>
              </div>

              <WorkScheduleEditor
                employeeId={selectedEmployee.id}
                canEdit={hasHrEditAccess}
                defaultEffectiveFrom={selectedEmployee.hiredOn ?? undefined}
              />

              {hasHrEditAccess ? (
                <InspectorEvidenceSection employeeId={selectedEmployee.id} />
              ) : null}

              {hasHrEditAccess ? (
                <div className='space-y-2'>
                  <Label htmlFor='employee-allowance-days'>{t('employees.detailSheet.allowanceDays')}</Label>
                  <Input
                    id='employee-allowance-days'
                    type='number'
                    min={0}
                    step={0.5}
                    placeholder={t('employees.detailSheet.allowanceDaysPlaceholder')}
                    value={sheetAllowanceDays}
                    onChange={(event) => setSheetAllowanceDays(event.target.value)}
                  />
                  <p className='text-xs text-slate-500'>
                    {t('employees.detailSheet.allowanceHint', { minutes: sheetAvgMinutes })}
                  </p>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!sheetAllowanceDays.trim() || updateMutation.isPending}
                    onClick={() => void handleSaveAllowanceDays()}
                  >
                    {t('employees.detailSheet.saveAllowance')}
                  </Button>
                </div>
              ) : null}

              <div className='space-y-2'>
                <Label htmlFor='employee-carryover-minutes'>{t('employees.detailSheet.carryover')}</Label>
                <Input
                  id='employee-carryover-minutes'
                  type='number'
                  min={MIN_LEAVE_MINUTES}
                  step={1}
                  value={carryoverMinutes}
                  aria-label={t('employees.detailSheet.carryoverAria')}
                  disabled={!hasHrEditAccess || patchLeaveBalanceMutation.isPending}
                  onChange={(event) => setCarryoverMinutes(event.target.value)}
                />
              </div>

              {hasHrEditAccess ? (
                <SheetFooter>
                  <Button
                    type='button'
                    onClick={() => void handleSaveCarryover()}
                    disabled={patchLeaveBalanceMutation.isPending}
                  >
                    {patchLeaveBalanceMutation.isPending ? t('employees.createDialog.saving') : t('employees.detailSheet.saveLeaveBalance')}
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
